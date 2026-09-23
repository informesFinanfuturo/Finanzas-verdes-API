const pool = require('../db');
const { askAIStructured, AIServiceError } = require('../services/iaService');


async function generarYSyncDiagnosticos(req, res) {
  const {
    id_mipyme,
    empresa = null,
    activos = [],
    facturas = [],
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!id_mipyme) {
      return res.status(400).json({
        error: 'id_mipyme es obligatorio',
      });
    }

    if (!req.user?.id_usuario) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const mipymeExists = await client.query(
      `SELECT id_mipyme FROM mipyme WHERE id_mipyme = $1`,
      [id_mipyme]
    );

    if (mipymeExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada',
      });
    }

    // ✅ catálogo filtrado
    const catalogo = await obtenerCatalogoRelevante(client, activos);

    console.log(
      "Productos enviados IA:",
      catalogo.length
    );

    if (catalogo.length > 0) {

      console.log(
        JSON.stringify(
          catalogo[0],
          null,
          2
        )
      );

    }

    let costoUnitarioEnergia = null;
    let costoUnitarioAgua = null;

    if (Array.isArray(facturas) && facturas.length > 0) {

      const facturasEnergia = facturas
        .filter(
          f =>
            (f.tipo_servicio || '')
              .toString()
              .toLowerCase()
              .includes('energia')
        )
        .sort(
          (a, b) =>
            new Date(b.periodo_fin) -
            new Date(a.periodo_fin)
        );

      const facturasAgua = facturas
        .filter(
          f =>
            (f.tipo_servicio || '')
              .toString()
              .toLowerCase()
              .includes('agua')
        )
        .sort(
          (a, b) =>
            new Date(b.periodo_fin) -
            new Date(a.periodo_fin)
        );

      costoUnitarioEnergia =
        facturasEnergia[0]
          ?.costo_unitario ?? null;

      costoUnitarioAgua =
        facturasAgua[0]
          ?.costo_unitario ?? null;

    }

    const contextoIA = {
      empresa,
      activos,
      facturas,
      catalogo,
      costo_unitario_energia: costoUnitarioEnergia,
      costo_unitario_agua: costoUnitarioAgua,
    };

    const diagnosticoIA = await generarDiagnosticoConIA(contextoIA);

    // ✅ verificar si ya existe uno
    // const existente = await client.query(
    //   `
    //   SELECT id_diagnostico
    //   FROM diagnostico
    //   WHERE id_mipyme = $1
    //     AND COALESCE(estado, 'activo') != 'eliminado'
    //   LIMIT 1
    //   `,
    //   [id_mipyme]
    // );

    let result;

    result = await client.query(
        `
        INSERT INTO diagnostico (
          titulo,
          problema,
          beneficios,
          id_mipyme,
          estado,
          created_at,
          created_by,
          metricas
        )
        VALUES ($1,$2,$3,$4,'activo',NOW(),$5, $6)
        RETURNING *
        `,
        [
          diagnosticoIA.titulo,
          diagnosticoIA.problema,
          diagnosticoIA.beneficios,
          id_mipyme,
          req.user.id_usuario,
          diagnosticoIA.metricas
        ]
      );

    // if (existente.rows.length === 0) {
    //   // ✅ CREATE
    //   result = await client.query(
    //     `
    //     INSERT INTO diagnostico (
    //       titulo,
    //       problema,
    //       beneficios,
    //       id_mipyme,
    //       estado,
    //       created_at,
    //       created_by,
    //       metricas
    //     )
    //     VALUES ($1,$2,$3,$4,'activo',NOW(),$5, $6)
    //     RETURNING *
    //     `,
    //     [
    //       diagnosticoIA.titulo,
    //       diagnosticoIA.problema,
    //       diagnosticoIA.beneficios,
    //       id_mipyme,
    //       req.user.id_usuario,
    //       diagnosticoIA.metricas
    //     ]
    //   );
    // } else {
    //   // ✅ UPDATE
    //   result = await client.query(
    //     `
    //     UPDATE diagnostico
    //     SET
    //       titulo = $1,
    //       problema = $2,
    //       beneficios = $3,
    //       updated_at = NOW(),
    //       updated_by = $5,
    //       metricas = $6
    //     WHERE id_diagnostico = $4
    //     RETURNING *
    //     `,
    //     [
    //       diagnosticoIA.titulo,
    //       diagnosticoIA.problema,
    //       diagnosticoIA.beneficios,
    //       existente.rows[0].id_diagnostico,
    //       req.user.id_usuario,
    //       diagnosticoIA.metricas
    //     ]
    //   );
    // }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Diagnóstico generado correctamente',
      diagnostico: result.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error generarDiagnosticos:', err);

    if (err instanceof AIServiceError) {
      return res.status(422).json({
        error: 'Error IA',
        ai_error: {
          code: err.code,
          message_user: err.messageUser,
        },
      });
    }

    return res.status(500).json({
      error: 'Error interno',
    });
  } finally {
    client.release();
  }
}


async function generarDiagnosticoConIA(contexto) {

  const response = await askAIStructured({
    modelo: "gemini-3.7-flash",
    role: `
      Eres un consultor especializado en sostenibilidad,
      eficiencia energética, finanzas verdes,
      optimización de recursos e innovación para
      micro y pequeñas empresas.

      Tu función es analizar:

      - Información empresarial.
      - Facturas de servicios públicos.
      - Activos identificados.
      - Catálogo de productos disponible.

      Debes identificar oportunidades reales de mejora
      utilizando exclusivamente los productos incluidos
      en el catálogo suministrado.

      No debes realizar búsquedas web ni utilizar
      información externa.

      Todas las recomendaciones deben basarse únicamente
      en la información entregada.
    `,
    taskDescription: `

    Analiza la información suministrada sobre:

    - La empresa.
    - Los consumos históricos.
    - Los activos identificados.
    - El catálogo de productos disponible.

    Identifica las principales oportunidades de mejora.

    Debes:

    1. Analizar patrones de consumo.

    2. Identificar posibles causas de ineficiencia.

    3. Relacionar dichas causas con los activos observados.

    4. Explicar detalladamente el estado actual de cada activo.

    5. Identificar activos prioritarios por:
      - consumo,
      - antigüedad,
      - impacto económico,
      - impacto ambiental.

    6. Comparar cada activo con los productos disponibles
      en el catálogo suministrado.

    7. Identificar productos del catálogo que puedan:

      - reemplazar activos existentes,
      - reducir consumos,
      - reducir costos,
      - mejorar eficiencia,
      - mejorar desempeño operativo.

    8. Explicar detalladamente los beneficios potenciales
      de cada reemplazo o mejora.

    9. Priorizar las oportunidades según:

      - potencial de ahorro,
      - impacto ambiental,
      - facilidad de implementación,
      - alineación con el catálogo.

    No utilices productos ni referencias que no estén
    presentes en el catálogo suministrado.
    `,
    contextData: contexto,
    outputSchemaExample: {
      titulo: 'Optimización del consumo eléctrico',
      problema: {
        resumen: '',
        detalle: '',
      },
      beneficios: {
        resumen: '',
        detalle: '',
      },
      metricas : {
        //consumo_energia_actual_mes : calculado,
        //consumo_energia_proyectado_mes : calculado,
        //consumo_agua_actual_mes : calculado,
        //consumo_agua_proyectado_mes : calculado,
        //costo_actual_mes : calculado
        //costo_proyectado_mes : calculado
        //ahorro_economico_mensual : calculado
        //inversion_total_requerida : calculado,
        //reduccion_co2_mensual : calculado,
        //payback : calculado
        activos : [
          {
            nombre_activo : "Nombre del activo",
            confianza : {
              nivel : "Alta | Media | Baja",
              motivo : ""
            },
            id_activo: null,
            prioridad : "Alta | Media | Baja",
            metricas : {
              consumo_energia_actual_mes : 200,
              consumo_energia_proyectado_mes : 150,
              consumo_agua_actual_mes : 200,
              consumo_agua_proyectado_mes : 150,
              //costo_actual_mes : calculado
              //costo_proyectado_mes : calculado
              //ahorro_economico_mensual : calculado
              inversion_total_requerida : 10000000,
              //reduccion_co2_mensual : calculado,
              vida_util_anios : null,
              //payback : calculado,
              //roi_anio : 1
            }
          }
        ]
      },
      evidencia_catalogo: [
        {
          "proveedor": "",
          "producto": "",
          "categoria": "",
          "url": "",
          "precio": null,
          "activo_relacionado": "",
          "atributos_comparados": [],
          "observacion": ""
        }
      ]
    },
    rules: [
      `
      RESTRICCIONES GLOBALES
 
- Utiliza exclusivamente la información suministrada en:
 
- información empresarial,
- facturas,
- activos identificados,
- catálogo de productos.
 
No utilices información externa, fuentes públicas, conocimiento de internet ni supuestos basados en experiencias generales del sector.
 
-No inventes:
 
- consumos,
- costos,
- ahorros,
- eficiencias,
- emisiones,
- características técnicas,
- especificaciones,
- vida útil,
- capacidades operativas,
- indicadores financieros,
- cualquier otro dato no respaldado por la información suministrada.
 
- Cuando la información disponible no sea suficiente para sustentar una conclusión, comparación o estimación:
 
- indícalo explícitamente,
- reduce el nivel de confianza correspondiente,
- evita conclusiones definitivas,
- retorna null en los campos cuantitativos afectados.
 
- Nunca conviertas una hipótesis en una afirmación.
 
Diferencia claramente entre:
 
- observaciones respaldadas por evidencia,
- oportunidades potenciales,
- recomendaciones respaldadas por evidencia suficiente,
- estimaciones cuantitativas.
 
- Toda recomendación de mejora, reemplazo, modernización o inversión debe estar asociada explícitamente a uno o más productos presentes en el catálogo suministrado.
 
No recomiendes productos, tecnologías, equipos o soluciones que no existan dentro del catálogo.
 
- No calcules indicadores financieros finales.
 
No debes calcular:
 
- ROI,
- Payback,
- VPN,
- TIR,
- Valor presente,
- Flujo de caja descontado.
 
Tu función consiste únicamente en identificar y estructurar las variables necesarias para cálculos posteriores.
 
- Todas las conclusiones, recomendaciones, comparaciones y métricas deben poder justificarse mediante evidencia presente en la información suministrada.
 
Toda recomendación debe poder trazarse explícitamente hasta:
 
- el activo analizado,
- la información disponible,
- el producto del catálogo utilizado como referencia.
 
PROCESO OBLIGATORIO DE EVALUACIÓN
 
PASO 1. CLASIFICACIÓN FUNCIONAL DEL ACTIVO
 
Determina utilizando exclusivamente la información suministrada:
 
- función principal,
- entorno de uso,
- categoría funcional,
- propósito operativo.
 
Ejemplos de categorías funcionales:
 
- refrigeración comercial
- refrigeración doméstica
- exhibición refrigerada
- congelación
- cocción
- iluminación
- climatización
- bombeo
- lavado
- producción
 
No inventes categorías, funciones, propósitos operativos, entornos de uso ni características que no estén respaldadas por la información suministrada.
 
Si la información disponible no permite determinar razonablemente uno o más de los siguientes elementos:
 
- función principal,
- entorno de uso,
- categoría funcional,
- propósito operativo,
 
debes indicarlo explícitamente y evitar asumir información no proporcionada.
 
PASO 2. CLASIFICACIÓN FUNCIONAL DE LOS PRODUCTOS DEL CATÁLOGO
 
Analiza cada producto del catálogo utilizando exclusivamente:
 
- nombre,
- descripción,
- especificaciones,
- categoría,
- atributos disponibles.
 
Determina para cada producto:
 
- función principal,
- entorno de uso,
- categoría funcional,
- propósito operativo.
 
No inventes categorías, funciones, propósitos operativos, entornos de uso ni características que no estén respaldadas por la información disponible del catálogo.
 
Si la información disponible no permite determinar razonablemente uno o más de los siguientes elementos:
 
- función principal,
- entorno de uso,
- categoría funcional,
- propósito operativo,
 
debes indicarlo explícitamente y evitar asumir información no proporcionada.
 
PASO 3. VALIDACIÓN DE COMPATIBILIDAD
 
Un producto del catálogo solo puede considerarse alternativa de un activo cuando exista compatibilidad funcional suficiente.
 
La compatibilidad funcional debe evaluarse comparando la clasificación obtenida para el activo y para el producto en las siguientes dimensiones:
 
- función principal,
- entorno de uso,
- categoría funcional,
- propósito operativo.
 
Dos equipos solo podrán considerarse funcionalmente compatibles cuando compartan tanto:
 
- la función principal,
- como el propósito operativo principal.
 
Adicionalmente, el entorno de uso y la categoría funcional deben ser consistentes con el propósito operativo que se busca cubrir.
 
Considera incompatibles:
 
- equipos con funciones principales claramente diferentes,
- equipos con propósitos operativos claramente diferentes,
- equipos domésticos respecto a equipos comerciales cuando la función o capacidad requerida no pueda ser cubierta razonablemente,
- equipos comerciales respecto a equipos industriales cuando la función o capacidad requerida no pueda ser cubierta razonablemente,
- equipos cuya capacidad operativa resulte evidentemente insuficiente para cumplir el mismo propósito operativo.
 
La coincidencia tecnológica, energética, de marca o de categoría general no es suficiente para establecer compatibilidad funcional.
 
Ejemplos:
 
- exhibición refrigerada ≠ almacenamiento refrigerado
- congelación ≠ refrigeración
- cocción ≠ calentamiento
- almacenamiento ≠ producción
 
Las diferencias de tamaño, capacidad, marca, diseño o especificaciones no implican por sí solas incompatibilidad funcional.
 
Si la información disponible no permite determinar razonablemente la compatibilidad funcional entre un activo y un producto:
 
- debes indicarlo explícitamente,
- debes reducir el nivel de confianza correspondiente,
- debes evitar asumir compatibilidad o incompatibilidad sin evidencia suficiente.
 
La ausencia de evidencia suficiente para validar una compatibilidad funcional debe tratarse como una limitación de información y no como una confirmación de compatibilidad.
 
PASO 4. DESCARTE OBLIGATORIO
 
Si no existe dentro del catálogo una alternativa funcionalmente compatible para un activo determinado:
 
- no recomiendes reemplazo,
- no sugieras migración,
- no sugieras modernización,
- no estimes beneficios,
- no estimes ahorros,
- no completes métricas proyectadas.
 
Debes indicar explícitamente que no existe una alternativa funcionalmente compatible dentro del catálogo suministrado.
 
Si la información disponible no permite determinar razonablemente la compatibilidad funcional entre el activo y los productos del catálogo:
 
- debes indicar explícitamente la limitación de información,
- debes reducir el nivel de confianza correspondiente,
- debes evitar recomendaciones concluyentes,
- no debes estimar beneficios, ahorros ni métricas proyectadas basadas en una compatibilidad no demostrada.
 
La ausencia de recomendación es un resultado correcto cuando:
 
- no existe una alternativa funcionalmente compatible,
- o la evidencia disponible es insuficiente para validar razonablemente una alternativa compatible.
 
PASO 5. EVALUACIÓN DE REEMPLAZO
 
Solo si existe compatibilidad funcional suficiente podrás analizar:
 
- eficiencia,
- antigüedad,
- costos,
- consumos,
- potencial de mejora,
- impacto ambiental.
 
Toda recomendación debe justificarse mediante evidencia disponible tanto del activo analizado como del producto del catálogo utilizado como referencia.
 
Cuando la información sea incompleta, podrás identificar oportunidades potenciales de mejora o formular recomendaciones exploratorias siempre que las limitaciones queden claramente explicadas.
 
Antes de recomendar cualquier reemplazo debes determinar si el problema identificado corresponde principalmente a:
 
- mantenimiento,
- reparación,
- operación,
- configuración,
- estado físico corregible,
- limitación estructural,
- obsolescencia tecnológica,
- fin de vida útil.
 
REGLA DE PRIORIZACIÓN ENTRE REPARACIÓN Y REEMPLAZO
 
Si la evidencia disponible indica razonablemente que el problema principal puede resolverse mediante:
 
- mantenimiento,
- reparación,
- calibración,
- limpieza,
- ajuste operativo,
- configuración,
- sustitución de componentes menores,
 
la recomendación principal debe ser la corrección de la causa identificada y la reevaluación posterior del desempeño del activo.
 
En estos casos no debes recomendar el reemplazo como acción principal.
 
Solo podrás recomendar el reemplazo como acción principal cuando exista evidencia suficiente de uno o más de los siguientes factores:
 
- obsolescencia tecnológica significativa,
- deterioro estructural relevante,
- múltiples fallas significativas,
- limitaciones operativas permanentes,
- fin de vida útil,
- imposibilidad razonable de recuperación mediante reparación.
 
Si la información disponible no permite determinar razonablemente si una condición corresponde a una falla corregible o a una limitación estructural o permanente:
 
- debes explicitar la incertidumbre,
- debes evitar conclusiones definitivas sobre la necesidad de reemplazo,
- debes reducir el nivel de confianza correspondiente.
 
Ante incertidumbre sobre la causa principal, prioriza reparación sobre reemplazo.
 
Diferencia claramente entre:
 
- oportunidad potencial de mejora,
- recomendación respaldada por evidencia suficiente,
- estimación cuantitativa.
 
Una oportunidad potencial de mejora puede identificarse con evidencia parcial.
 
Una recomendación respaldada requiere evidencia suficiente para justificar la acción propuesta.
 
Una estimación cuantitativa requiere evidencia numérica suficiente para sustentar los cálculos asociados.
 
Estos tres niveles no deben confundirse.
 
PASO 6. SELECCIÓN DETERMINÍSTICA DE ALTERNATIVAS
 
Si existen varias alternativas funcionalmente compatibles dentro del catálogo, aplica estrictamente el siguiente orden de prioridad:
 
1. Compatibilidad funcional.
2. Similitud operativa.
3. Similitud de capacidad.
4. Eficiencia sustentada por las especificaciones disponibles.
5. Ventaja demostrable mediante la evidencia disponible y el costo observado.
 
Debes seleccionar únicamente la alternativa mejor alineada.
 
Solo podrás reportar múltiples alternativas cuando la información disponible no permita diferenciarlas objetivamente mediante los criterios anteriores.
 
En estos casos debes explicar explícitamente la limitación de información que impide seleccionar una única alternativa.
 
PASO 7. MANEJO DE INCERTIDUMBRE Y VALIDEZ DE LAS COMPARACIONES
 
Cuando falten datos relevantes para evaluar un activo o compararlo con un producto del catálogo:
 
- utiliza confianza baja,
- explica claramente las limitaciones identificadas,
- evita conclusiones definitivas,
- evita cuantificar beneficios no respaldados por evidencia suficiente.
 
Nunca conviertas una hipótesis en una afirmación.
 
Nunca asumas especificaciones técnicas, consumos, eficiencias, capacidades o características que no hayan sido proporcionadas.
REGLA DE LÍNEA BASE INVÁLIDA
 
Cuando exista evidencia de que un activo presenta una falla, condición operativa anormal o deterioro significativo que pueda alterar su desempeño normal, consumo, capacidad o eficiencia:
 
- no debes considerar el desempeño observado como representativo del comportamiento normal del activo,
- no debes utilizar dicho desempeño como línea base para justificar beneficios cuantitativos de reemplazo,
- no debes asumir que las diferencias observadas frente a una alternativa del catálogo representan ahorros o mejoras reales.
Si la línea base del activo no puede considerarse válida debido a una falla no corregida o a una condición operativa anormal:
 
- puedes identificar oportunidades potenciales de reemplazo o modernización cuando exista evidencia suficiente para ello,
- puedes recomendar reemplazo cuando esté respaldado por la evaluación realizada en el PASO 5,
- pero no debes estimar beneficios cuantitativos derivados de una comparación directa.
 
En estos casos debes retornar null en cualquier métrica que dependa de la comparación entre el activo actual y la alternativa propuesta, incluyendo cuando corresponda:
 
- consumo_energia_proyectado_mes,
- consumo_agua_proyectado_mes,
- ahorro_economico_mensual,
- reduccion_co2_mensual,
- cualquier otra métrica comparativa cuya estimación dependa de una línea base no válida.
Cuando la confianza sea baja:
 
- explica claramente las limitaciones de información,
- evita conclusiones definitivas,
- evita cuantificar beneficios no demostrados,
- puedes identificar oportunidades potenciales de mejora cuando exista evidencia razonable.
 
La confianza baja no impide identificar oportunidades potenciales.
 
La confianza baja sí limita la capacidad de generar comparaciones cuantitativas y estimaciones respaldadas.
 
PASO 8. CONSISTENCIA DE LA RESPUESTA
 
Activos funcionalmente equivalentes y con evidencia de calidad similar deben recibir decisiones consistentes.
 
Debes aplicar de forma consistente los criterios definidos en los pasos anteriores.
 
Si dos activos presentan:
 
- función principal equivalente,
- entorno de uso equivalente,
- propósito operativo equivalente,
- condiciones operativas comparables,
- evidencia de calidad similar,
- problemas de naturaleza similar,
 
deben recibir:
 
- el mismo tipo de recomendación,
- niveles de prioridad consistentes,
- niveles de confianza consistentes,
 
salvo que exista evidencia objetiva presente en la información suministrada que justifique una diferencia.
 
No generes recomendaciones, prioridades o niveles de confianza diferentes para activos equivalentes sin una justificación respaldada por evidencia.
 
Toda diferencia entre decisiones debe poder explicarse mediante información presente en:
 
- los activos analizados,
- las facturas suministradas,
- el catálogo de productos.
 
Las decisiones deben derivarse exclusivamente de los criterios definidos en los pasos anteriores.
 
No utilices preferencias implícitas, supuestos adicionales ni criterios no definidos en el proceso de evaluación para diferenciar entre alternativas o recomendaciones.
 
Cuando la misma evidencia conduzca a la misma clasificación funcional, compatibilidad, condición operativa y nivel de incertidumbre, la decisión resultante debe ser consistente.
 
REGLAS DE CONSTRUCCION DE LA RESPUESTA
 
- El campo problema debe explicar:
 
- Qué se observó.
- Qué evidencia suministrada respalda cada observación.
- Por qué la situación observada representa un problema, riesgo o área potencial de  mejora.
- Qué impacto económico cualitativo podría estar generando.
- Qué impacto ambiental cualitativo podría estar generando.
 
Debes diferenciar claramente entre:
 
- observaciones respaldadas por evidencia,
- interpretaciones razonables,
- incertidumbres o limitaciones de información.
 
Cuando la evidencia disponible sea insuficiente para confirmar una causa, problema o impacto específico:
 
- debes indicarlo explícitamente,
- debes evitar afirmaciones concluyentes,
- debes describir la situación como una condición potencial o una hipótesis pendiente de validación.
 
La descripción debe incluir tanto una visión general del diagnóstico como el análisis individual de cada activo reportado en la salida.
 
El campo beneficios debe explicar:
 
- Qué acción se recomienda.
- Cómo la acción propuesta aborda el problema identificado.
- Qué beneficios pueden respaldarse razonablemente con la evidencia disponible.
- Qué mejoras operativas potenciales podrían obtenerse.
- Qué limitaciones existen para validar los beneficios esperados.
 
Debes diferenciar claramente entre:
 
- beneficios respaldados por evidencia suficiente,
- beneficios potenciales que requieren validación adicional,
- beneficios que no pueden determinarse con la información disponible.
 
Cuando la evidencia disponible no permita demostrar una mejora específica:
 
- no afirmes reducciones de consumo,
- no afirmes reducciones de costos,
- no afirmes mejoras ambientales,
- no afirmes mejoras operativas,
 
salvo que dichas conclusiones estén respaldadas por evidencia suficiente.
 
Cuando la comparación esté afectada por información insuficiente, confianza baja o una línea base no válida según el PASO 7:
 
- puedes describir oportunidades potenciales de mejora,
- puedes explicar las razones que justifican la recomendación,
- pero debes evitar afirmar beneficios cuantitativos o cualitativos no demostrados.
 
La descripción debe incluir tanto una visión general del diagnóstico como el análisis individual de cada activo reportado en la salida.
 
- Seleccion de activos para la salida
 
Todos los activos suministrados deben ser evaluados siguiendo el proceso completo de análisis.
 
Sin embargo, el arreglo metricas.activos únicamente debe incluir activos que cumplan al menos una de las siguientes condiciones:
 
- existe una recomendación respaldada por evidencia suficiente,
- existe una oportunidad potencial de mejora,
- el activo ha sido clasificado como prioritario,
- el activo ha sido clasificado como crítico.
 
No incluyas activos cuyo resultado final sea simultáneamente:
 
- funcionamiento adecuado,
- sin problemas relevantes identificados,
- sin oportunidad de mejora identificada,
- sin recomendación,
- sin prioridad,
- sin criticidad.
 
La inclusión o exclusión de activos debe basarse exclusivamente en estos criterios y aplicarse de forma consistente.
 
- Recomendaciones y comparaciones
 
Toda recomendación de mejora, reemplazo, modernización o inversión debe estar asociada  explícitamente a un producto existente dentro del catálogo suministrado.
 
No recomiendes tecnologías, equipos, soluciones o alternativas que no puedan relacionarse  directamente con un producto identificado en el catálogo.
 
Toda recomendación debe indicar claramente:
 
- el activo analizado,
- el producto utilizado como referencia,
- la relación funcional entre ambos,
- el motivo de la recomendación,
- los atributos utilizados en la comparación,
- las limitaciones de la evaluación cuando existan.
 
Cuando una recomendación incluya una comparación entre un activo y un producto del  catálogo, dicha comparación debe basarse exclusivamente en la evidencia disponible para  ambos.
 
No afirmes beneficios, ahorros, mejoras operativas, impactos económicos o impactos ambientales que no puedan justificarse con la información suministrada.
 
- Evidencia del catálogo
 
El arreglo evidencia_catalogo debe contener todos los productos del catálogo que hayan sido utilizados para construir una recomendación, comparación o conclusión incluida en la respuesta.
 
No omitas ninguna referencia utilizada como soporte de una recomendación o comparación.
 
Para cada producto incluido debes registrar, cuando la información esté disponible:
 
- proveedor,
- producto,
- categoría,
- precio,
- URL,
- activo relacionado,
- atributos comparados,
- observación o justificación de uso.
 
Las recomendaciones y comparaciones deben fundamentarse prioritariamente en la información disponible del catálogo, incluyendo cuando corresponda:
 
- nombre del producto,
- categoría,
- descripción,
- especificaciones,
- precio,
- URL,
- atributos disponibles.
 
El propósito de evidencia_catalogo es documentar la evidencia utilizada para justificar cada recomendación o comparación realizada.
 
- Selección final de alternativa para la salida
 
Cada activo incluido en la respuesta estructurada debe estar asociado a una única alternativa del catálogo.
 
Si durante la evaluación se identifican múltiples alternativas funcionalmente compatibles y la información disponible no permite diferenciarlas objetivamente mediante los criterios definidos en el PASO 6:
 
- puedes mencionar dicha equivalencia dentro del análisis cualitativo,
- puedes explicar las limitaciones que impiden una diferenciación objetiva,
 
sin embargo:
 
- debes seleccionar una única alternativa para completar la salida estructurada,
- debes utilizar únicamente esa alternativa para las métricas, comparaciones y referencias asociadas al activo,
- no debes incluir múltiples alternativas para un mismo activo dentro del JSON.
 
La alternativa seleccionada debe corresponder a una de las alternativas consideradas compatibles durante la evaluación.
 
REGLAS DE FORMATO Y ESTRUCTURA
 
- ESTRUCTURA DE LA RESPUESTA
 
La respuesta debe contener únicamente un JSON válido.
No generes campos adicionales.
Respeta estrictamente la estructura definida en el esquema de salida.
 
- RESÚMENES Y DETALLES
 
Los campos de resumen deben ser breves y concisos.
Los campos de detalle deben ser extensos, explicativos y coherentes con la evidencia disponible.
Utiliza doble salto de línea (\n\n) dentro de los campos de detalle para mejorar la legibilidad.
 
- ESTILO DE REDACCIÓN
 
Utiliza lenguaje profesional orientado a empresarios no técnicos.
Evita tecnicismos innecesarios cuando no aporten valor al diagnóstico.
 
- REFERENCIAS E IDENTIFICADORES
 
No muestres IDs internos utilizados para identificar activos, productos o elementos del catálogo.
Utiliza nombres descriptivos y comprensibles para el usuario final.
 
- VALORES ECONÓMICOS
 
Cuando un valor económico deba mostrarse dentro de los campos narrativos de la respuesta, utiliza formato de moneda (pesos colombianos, sin decimales).
 
Esta regla aplica únicamente a los textos descriptivos y no modifica los tipos de datos definidos para las métricas.
 
- MÉTRICAS
 
Los campos de métricas deben contener exclusivamente valores numéricos o null.
 
No utilices texto descriptivo dentro de los campos de métricas.
 
Las métricas deben representar variables observadas o derivadas razonablemente de la información suministrada.
 
Las métricas no representan indicadores financieros finales ni conclusiones económicas.
 
Los consumos reportados en las métricas deben corresponder a los activos analizados y no a valores agregados de las facturas.
 
Cuando una métrica no pueda determinarse razonablemente con la evidencia disponible, debes retornar null.
      `
    ],
    imagePaths: [],
  });

// Enriquecer activos
  const activosDiagnostico =
    response.metricas?.activos ?? [];

  for (const activoDiag of activosDiagnostico) {

    const activoOriginal =
      contexto.activos.find(a =>
        normalizeText(a.nombre) ===
        normalizeText(activoDiag.nombre_activo)
      );

    activoDiag.id_activo =
      activoOriginal?.id_activo ?? null;
  }

  return {
    titulo: response.titulo,
    problema: response.problema ?? {},
    beneficios: response.beneficios ?? {},
    metricas: response.metricas ?? {},
    evidencia_catalogo:
      response.evidencia_catalogo ?? []
  };

  
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function esTipoElectrodomestico(activo) {
  const tipo = normalizeText(activo?.tipo);
  const nombre = normalizeText(activo?.nombre);
  const descripcion = normalizeText(activo?.descripcion);

  const palabrasClave = [
    'electrodomestico',
    'electrodoméstico',
    'nevera',
    'refrigerador',
    'congelador',
    'lavadora',
    'secadora',
    'microondas',
    'televisor',
    'aire acondicionado',
    'ventilador',
    'horno',
    'cafetera',
    'licuadora',
  ];

  return palabrasClave.some(
    (kw) =>
      tipo.includes(kw) ||
      nombre.includes(kw) ||
      descripcion.includes(kw)
  );
}

function esTipoServicio(activo) {
  const tipo = normalizeText(activo?.tipo);
  return tipo.includes('servicio');
}

function validarContextoDiagnostico({
  empresa,
  activos = [],
  facturas = [],
  diagnosticos = [],
}) {
  const errores = [];
  const warnings = [];

  const hayEmpresa = empresa && Object.keys(empresa).length > 0;
  const hayActivos = Array.isArray(activos) && activos.length > 0;
  const hayFacturas = Array.isArray(facturas) && facturas.length > 0;
  const hayDiagnosticos =
    Array.isArray(diagnosticos) && diagnosticos.length > 0;

  if (!hayEmpresa && !hayActivos && !hayFacturas && !hayDiagnosticos) {
    errores.push(
      'Debes enviar al menos una fuente de contexto: empresa, activos, facturas o diagnosticos.'
    );
  }

  const activosElectrodomesticos = (activos || []).filter(
    esTipoElectrodomestico
  );

  if (activosElectrodomesticos.length > 0 && !hayFacturas) {
    errores.push(
      'No se puede generar diagnóstico porque hay activos de tipo electrodoméstico y no se recibieron facturas.'
    );
  }

  const activosServicios = (activos || []).filter(esTipoServicio);

  if (
    activosServicios.length > 0 &&
    activosElectrodomesticos.length === 0 &&
    !hayFacturas
  ) {
    warnings.push(
      'Se permite continuar sin facturas porque los activos recibidos parecen corresponder a servicios.'
    );
  }

  if (hayFacturas && !hayActivos) {
    warnings.push(
      'Se recibieron facturas sin activos. El diagnóstico se basará principalmente en consumos.'
    );
  }

  return {
    ok: errores.length === 0,
    errores,
    warnings,
    resumen: {
      hayEmpresa,
      hayActivos,
      hayFacturas,
      hayDiagnosticos,
      activosElectrodomesticos: activosElectrodomesticos.length,
      activosServicios: activosServicios.length,
    },
  };
}

async function syncDiagnosticosDeMipyme(
  client,
  idMipyme,
  diagnosticosIA,
  userId
) {
  const existingResult = await client.query(
    `
    SELECT id_diagnostico, titulo, problema, beneficios
    FROM diagnostico
    WHERE id_mipyme = $1
      AND COALESCE(estado, 'activo') != 'eliminado'
    `,
    [idMipyme]
  );

  const existentes = existingResult.rows;

  const mapExistentes = {};
  for (const row of existentes) {
    mapExistentes[row.titulo.trim().toLowerCase()] = row;
  }

  const resultados = [];

  for (const diag of diagnosticosIA) {
    const titulo = diag.titulo?.trim();
    if (!titulo) continue;

    const problema = diag.problema ?? {};
    const beneficios = diag.beneficios ?? {};

    const existente = mapExistentes[titulo.toLowerCase()];

    if (!existente) {
      const created = await client.query(
        `
        INSERT INTO diagnostico (
          titulo,
          problema,
          beneficios,
          id_mipyme,
          estado,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, 'activo', NOW(), NULL, $5, NULL)
        RETURNING *
        `,
        [titulo, problema, beneficios, idMipyme, userId]
      );

      resultados.push({
        accion: 'create',
        data: created.rows[0],
      });

      continue;
    }

    const anterior = JSON.stringify({
      problema: existente.problema,
      beneficios: existente.beneficios,
    });

    const nuevo = JSON.stringify({
      problema,
      beneficios,
    });

    if (anterior === nuevo) {
      resultados.push({
        accion: 'sin_cambios',
        data: existente,
      });
      continue;
    }

    const updated = await client.query(
      `
      UPDATE diagnostico
      SET
        problema = $1,
        beneficios = $2,
        updated_at = NOW(),
        updated_by = $4
      WHERE id_diagnostico = $3
      RETURNING *
      `,
      [problema, beneficios, existente.id_diagnostico, userId]
    );

    resultados.push({
      accion: 'update',
      data: updated.rows[0],
    });
  }

  return resultados;
}

async function construirDiagnosticosCompletos(
  idMipyme
) {

  const result = await pool.query(
    `
    SELECT *
    FROM diagnostico
    WHERE id_mipyme = $1
      AND COALESCE(estado, 'activo') != 'eliminado'
    ORDER BY created_at DESC
    `,
    [idMipyme]
  );

  const diagnosticos = result.rows;

  if (diagnosticos.length === 0) {
  return [];
}

  const costosResult =
    await pool.query(
      `
      SELECT
        tipo,
        costo_unitario,
        periodo_fin
      FROM consumo
      WHERE id_mipyme = $1
        AND costo_unitario IS NOT NULL
      ORDER BY periodo_fin DESC
      `,
      [idMipyme]
    );

  let costoUnitarioEnergia = null;
  let costoUnitarioAgua = null;

  for (const row of costosResult.rows) {

    const tipo = (
      row.tipo || ''
    )
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      );

    if (
      costoUnitarioEnergia == null &&
      tipo.includes('energia')
    ) {
      costoUnitarioEnergia =
        Number(
          row.costo_unitario
        );
    }

    if (
      costoUnitarioAgua == null &&
      tipo.includes('agua')
    ) {
      costoUnitarioAgua =
        Number(
          row.costo_unitario
        );
    }

  }

  for (const diagnostico of diagnosticos) {

    const metricas =
      JSON.parse(
        JSON.stringify(
          diagnostico.metricas || {}
        )
      );

    // TODO:
    // todo el cálculo que ya tienes

    diagnostico.metricas = metricas;
  }

  for (const diagnostico of diagnosticos) {

    const metricas =
      JSON.parse(
        JSON.stringify(
          diagnostico.metricas || {}
        )
      );

        const activos =
          metricas.activos || [];

        for (const activo of activos) {

        const m =
          activo.metricas || {};

        const costoActualEnergia =
          m.consumo_energia_actual_mes == null ||
          costoUnitarioEnergia == null
            ? null
            : m.consumo_energia_actual_mes *
              costoUnitarioEnergia;

        const costoNuevoEnergia =
          m.consumo_energia_proyectado_mes == null ||
          costoUnitarioEnergia == null
            ? null
            : m.consumo_energia_proyectado_mes *
              costoUnitarioEnergia;

        const costoActualAgua =
          m.consumo_agua_actual_mes == null ||
          costoUnitarioAgua == null
            ? null
            : m.consumo_agua_actual_mes *
              costoUnitarioAgua;

        const costoNuevoAgua =
          m.consumo_agua_proyectado_mes == null ||
          costoUnitarioAgua == null
            ? null
            : m.consumo_agua_proyectado_mes *
              costoUnitarioAgua;

        m.costo_actual_mes =
          (costoActualEnergia ?? 0) +
          (costoActualAgua ?? 0);

        m.costo_proyectado_mes =
          (costoNuevoEnergia ?? 0) +
          (costoNuevoAgua ?? 0);

        m.ahorro_economico_mensual =
          m.costo_proyectado_mes == 0 ?
          0 :
            m.costo_actual_mes - m.costo_proyectado_mes;
        
          // ✅ Reducción de energía
    m.reduccion_energia =
      m.consumo_energia_actual_mes == null ||
      m.consumo_energia_proyectado_mes == null
        ? null
        : m.consumo_energia_actual_mes -
          m.consumo_energia_proyectado_mes;

    // ✅ Reducción de agua
    m.reduccion_agua =
      m.consumo_agua_actual_mes == null ||
      m.consumo_agua_proyectado_mes == null
        ? null
        : m.consumo_agua_actual_mes -
          m.consumo_agua_proyectado_mes;

    // ✅ Reducción CO2
    // Factor aproximado: 0.164 kgCO2e por kWh
    m.reduccion_carbono =
      m.reduccion_energia == null
        ? null
        : 
        m.reduccion_energia * 0.22; // FACTOR PROPORCIONADO POR SENTIDO VERDE ⚠️⚠️⚠️⚠️⚠️

    // ✅ ROI 5 años
    const ahorro5Anios =
      m.ahorro_economico_mensual == null
        ? null
        : m.ahorro_economico_mensual * 60;

    m.roi_5_anios =
      ahorro5Anios == null ||
      m.inversion_total_requerida == null ||
      m.inversion_total_requerida <= 0
        ? null
        : (
            (
              ahorro5Anios -
              m.inversion_total_requerida
            )
            /
            m.inversion_total_requerida
          ) * 100;

        activo.metricas = m;

      }

        metricas.consumo_energia_actual_mes =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.consumo_energia_actual_mes || 0),
        0
      );

    metricas.consumo_energia_proyectado_mes =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.consumo_energia_proyectado_mes || 0),
        0
      );

    metricas.consumo_agua_actual_mes =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.consumo_agua_actual_mes || 0),
        0
      );

    metricas.consumo_agua_proyectado_mes =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.consumo_agua_proyectado_mes || 0),
        0
      );

    metricas.costo_actual_mes =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.costo_actual_mes || 0),
        0
      );

    metricas.costo_proyectado_mes =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.costo_proyectado_mes || 0),
        0
      );

    metricas.ahorro_economico_mensual =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.ahorro_economico_mensual || 0),
        0
      );

      metricas.inversion_total_requerida =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.inversion_total_requerida || 0),
        0
      );

      metricas.reduccion_energia =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.reduccion_energia || 0),
        0
      );

    metricas.reduccion_agua =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.reduccion_agua || 0),
        0
      );

    metricas.reduccion_carbono =
      activos.reduce(
        (sum, a) =>
          sum +
          (a.metricas?.reduccion_carbono || 0),
        0
      );

      const ahorro5AniosGlobal =
      metricas.ahorro_economico_mensual * 60;

    metricas.roi =
      metricas.inversion_total_requerida > 0
        ? (
            (
              ahorro5AniosGlobal -
              metricas.inversion_total_requerida
            )
            /
            metricas.inversion_total_requerida
          ) * 100
        : null;

      metricas.payback =
      metricas.inversion_total_requerida > 0 &&
      metricas.ahorro_economico_mensual > 0
        ? metricas.inversion_total_requerida /
          metricas.ahorro_economico_mensual
        : null;

      

      diagnostico.metricas =
        metricas;
  }

  return diagnosticos;

}

async function getMisDiagnosticos(
  req,
  res
) {

  const idUsuario =
    req.user?.id_usuario;

  try {

    if (!idUsuario) {
      return res.status(401).json({
        error:
          'Usuario no autenticado'
      });
    }

    const mipymeResult =
      await pool.query(
        `
        SELECT m.id_mipyme
        FROM mipyme_usuario mu
        INNER JOIN mipyme m
          ON m.id_mipyme = mu.id_mipyme
        WHERE mu.id_usuario = $1
        `,
        [idUsuario]
      );

    const idMipyme =
      mipymeResult.rows[0]
        ?.id_mipyme;

    if (!idMipyme) {

      return res.status(404).json({
        error:
          'No se encontró una mipyme asociada'
      });

    }

    const diagnostico =
      await construirDiagnosticoCompleto(
        idMipyme
      );

    return res.status(200).json({
      diagnostico,
    });

  } catch (err) {

    console.error(
      'Error getMisDiagnosticos:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno'
    });

  }

}

async function obtenerCatalogoRelevante(
  client,
  activos = []
) {

  const categorias = [
    ...new Set(
      activos
        .map(a =>
          normalizeText(a.tipo)
        )
        .filter(Boolean)
    )
  ];

  if (categorias.length === 0) {
    return [];
  }

  const result = await client.query(
    `
    SELECT
      id_item,
      tipo_item,
      nombre,
      descripcion,
      especificaciones,
      precio_base,
      disponible,
      id_proveedor,
      url_origen
    FROM item_catalogo
    WHERE disponible = true
      AND EXISTS (
        SELECT 1
        FROM unnest($1::text[]) c
        WHERE LOWER(
          COALESCE(tipo_item,'')
        ) = c
      )
    `,
    [categorias]
  );

  return result.rows;

}

async function guardarSeleccionActivos(
  req,
  res
) {

  const {
    idDiagnostico
  } = req.params;

  const {
    activos_seleccionados
  } = req.body;

  try {

    const result =
      await pool.query(
        `
        SELECT metricas
        FROM diagnostico
        WHERE id_diagnostico = $1
        `,
        [idDiagnostico]
      );

    if(result.rows.length === 0){
      return res.status(404).json({
        error: 'Diagnóstico no encontrado'
      });
    }

    const metricas =
      result.rows[0].metricas || {};

    metricas.activos_seleccionados =
      activos_seleccionados;

    const updated =
      await pool.query(
        `
        UPDATE diagnostico
        SET
          metricas = $1,
          updated_at = NOW(),
          updated_by = $2
        WHERE id_diagnostico = $3
        RETURNING *
        `,
        [
          metricas,
          req.user.id_usuario,
          idDiagnostico
        ]
      );

    return res.json({
      diagnostico:
        updated.rows[0]
    });

  } catch(err){

    console.error(err);

    return res.status(500).json({
      error: 'Error interno'
    });
  }
}

module.exports = {
  generarYSyncDiagnosticos,
  getMisDiagnosticos,
  construirDiagnosticosCompletos,
  guardarSeleccionActivos,
};