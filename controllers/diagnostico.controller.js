const pool = require('../db');
const { askAIStructured, AIServiceError } = require('../services/iaService');
const { requireMipymeAccess } = require('../utils/accessControl');


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

    await requireMipymeAccess(client, req.user.id_usuario, id_mipyme);

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

    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
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
             producto_recomendado: {
              id_item: 1,
              id_proveedor: 1,
              motivo_seleccion: "Explicación breve de por qué este producto es la mejor alternativa para el activo"
            },
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

Para cada activo incluido en metricas.activos debes devolver obligatoriamente:

- producto_recomendado.id_item,
- producto_recomendado.id_proveedor,
- producto_recomendado.motivo_seleccion.

El id_item debe corresponder exactamente a un producto existente dentro del catálogo suministrado.

El id_proveedor debe coincidir exactamente con el id_proveedor del producto seleccionado.

No escribas el nombre del producto como sustituto del id_item.

No devuelvas un producto que no se encuentre en el catálogo.

No devuelvas null en id_item o id_proveedor cuando incluyas el activo dentro de metricas.activos.

Las métricas proyectadas y la inversión de cada activo deben corresponder exclusivamente al producto identificado en producto_recomendado.
 
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
 
No muestres IDs internos dentro de los textos narrativos destinados al usuario final.

Sin embargo, debes conservar y devolver los identificadores internos en los campos estructurados definidos para ello:

- id_activo,
- producto_recomendado.id_item,
- producto_recomendado.id_proveedor.

Estos identificadores deben copiarse exactamente de la información suministrada.

No inventes, transformes, intercambies ni deduzcas identificadores.

Los IDs estructurados son necesarios para validar técnicamente la recomendación, pero no deben mencionarse dentro de problema, beneficios, resúmenes, detalles ni motivo_seleccion.
 
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
  
  /*
  * Validamos y enriquecemos cada
  * recomendación generada por Gemini.
  */
  const activosDiagnostico = response.metricas?.activos ?? [];

  if (!Array.isArray(activosDiagnostico)) {
    throw new Error(
      'La IA devolvió una estructura inválida para metricas.activos'
    );
  }

  for (
    const activoDiag
    of activosDiagnostico
  ) {

    /*
    * Primero intentamos relacionar por ID.
    * Si Gemini no lo conservó, usamos el
    * nombre como mecanismo secundario.
    */
    const idActivoIA =
      Number(
        activoDiag?.id_activo
      );

    const activoOriginal =
      contexto.activos.find(
        activo =>
          Number.isInteger(
            idActivoIA
          ) &&
          Number(
            activo.id_activo
          ) ===
          idActivoIA
      ) ??
      contexto.activos.find(
        activo =>
          normalizeText(
            activo.nombre
          ) ===
          normalizeText(
            activoDiag
              ?.nombre_activo
          )
      );

    if (!activoOriginal) {
      throw new Error(
        `La IA recomendó un activo que no pudo relacionarse con los activos originales: ${
          activoDiag
            ?.nombre_activo ??
          'sin nombre'
        }`
      );
    }

    activoDiag.id_activo =
      Number(
        activoOriginal
          .id_activo
      );

    activoDiag.nombre_activo =
      activoOriginal.nombre;

    const recomendacionIA =
      activoDiag
        ?.producto_recomendado;

    const idItem =
      Number(
        recomendacionIA
          ?.id_item
      );

    const idProveedor =
      Number(
        recomendacionIA
          ?.id_proveedor
      );

    if (
      !Number.isInteger(
        idItem
      ) ||
      !Number.isInteger(
        idProveedor
      )
    ) {
      throw new Error(
        `La IA no devolvió un producto válido para el activo ${activoOriginal.nombre}`
      );
    }

    /*
    * Buscamos el producto únicamente
    * dentro del catálogo oficial que fue
    * enviado a Gemini.
    */
    const productoCatalogo =
      contexto.catalogo.find(
        producto =>
          Number(
            producto.id_item
          ) ===
          idItem
      );

    if (!productoCatalogo) {
      throw new Error(
        `La IA recomendó el producto ${idItem}, pero no existe en el catálogo suministrado`
      );
    }

    if (
      Number(
        productoCatalogo
          .id_proveedor
      ) !==
      idProveedor
    ) {
      throw new Error(
        `El proveedor devuelto por la IA no corresponde al producto ${idItem}`
      );
    }

    if (
      productoCatalogo
        .disponible !== true
    ) {
      throw new Error(
        `La IA recomendó un producto que no está disponible: ${idItem}`
      );
    }

    /*
    * Aunque el catálogo enviado ya fue
    * filtrado, validamos nuevamente la
    * categoría para evitar asociaciones
    * incorrectas.
    */
    if (
      normalizeText(
        productoCatalogo
          .tipo_item
      ) !==
      normalizeText(
        activoOriginal.tipo
      )
    ) {
      throw new Error(
        `El producto ${idItem} no es compatible con el tipo del activo ${activoOriginal.nombre}`
      );
    }

    const cantidad =
      Number(
        activoOriginal.cantidad ??
        1
      ) || 1;

    const precioUnitario =
      Number(
        productoCatalogo
          .precio_base
      );

    if (
      !Number.isFinite(
        precioUnitario
      ) ||
      precioUnitario < 0
    ) {
      throw new Error(
        `El producto ${idItem} no tiene un precio válido`
      );
    }

    /*
    * Reemplazamos la información generada
    * por Gemini por la información oficial
    * del catálogo.
    */
    activoDiag
      .producto_recomendado = {

      id_item:
        Number(
          productoCatalogo
            .id_item
        ),

      id_proveedor:
        Number(
          productoCatalogo
            .id_proveedor
        ),

      nombre:
        productoCatalogo
          .nombre,

      tipo_item:
        productoCatalogo
          .tipo_item,

      cantidad_activo: cantidad,

      descripcion:
        productoCatalogo
          .descripcion,

      especificaciones:
        productoCatalogo
          .especificaciones,

      precio_base:
        precioUnitario,

      url_origen:
        productoCatalogo
          .url_origen,

      proveedor: {
        id_proveedor:
          Number(
            productoCatalogo
              .id_proveedor
          ),

        nombre:
          productoCatalogo
            .nombre_proveedor,

        nit:
          productoCatalogo
            .nit_proveedor,

        calificacion:
          productoCatalogo
            .calificacion_proveedor,
      },

      motivo_seleccion:
        recomendacionIA
          ?.motivo_seleccion ??
        '',

      fuente:
        'ia',

      seleccionado_at:
        new Date()
          .toISOString(),
    };

    activoDiag.metricas = {
      ...(
        activoDiag.metricas ||
        {}
      ),

      /*
      * La inversión siempre utiliza el
      * precio oficial del catálogo.
      */
      inversion_total_requerida:
        precioUnitario *
        cantidad,
    };
  }

  response.metricas = {
    ...(
      response.metricas ||
      {}
    ),

    evidencia_catalogo:
      Array.isArray(
        response.evidencia_catalogo
      )
        ? response
            .evidencia_catalogo
        : [],
  };

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

const FACTOR_CO2_KG_POR_KWH = 0.22;
const MESES_PROYECCION_ROI = 60;

function numeroFinitoONull(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  const textoOriginal =
    value
      .toString()
      .trim();

  if (!textoOriginal) {
    return null;
  }

  /*
   * Extrae únicamente el primer bloque
   * numérico de expresiones como:
   *
   * 24.5 Kilovatio-hora/Mes
   * 320 kWh/año
   * 1.999.900 COP
   * 18,5 litros por ciclo
   */
  const coincidencia =
    textoOriginal.match(
      /-?\d[\d.,]*/
    );

  if (!coincidencia) {
    return null;
  }

  let texto =
    coincidencia[0];

  if (
    texto.includes('.') &&
    texto.includes(',')
  ) {
    const ultimaComa =
      texto.lastIndexOf(',');

    const ultimoPunto =
      texto.lastIndexOf('.');

    if (ultimaComa > ultimoPunto) {
      texto = texto
        .replace(/\./g, '')
        .replace(',', '.');
    } else {
      texto =
        texto.replace(/,/g, '');
    }
  } else if (
    /^\d{1,3}(\.\d{3})+$/.test(
      texto
    )
  ) {
    texto =
      texto.replace(/\./g, '');
  } else if (
    /^\d{1,3}(,\d{3})+$/.test(
      texto
    )
  ) {
    texto =
      texto.replace(/,/g, '');
  } else {
    texto =
      texto.replace(',', '.');
  }

  const resultado =
    Number(texto);

  return Number.isFinite(
    resultado
  )
    ? resultado
    : null;
}

function normalizarClaveMetrica(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function aplanarEspecificaciones(
  value,
  prefix = '',
  output = {}
) {
  if (
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      aplanarEspecificaciones(
        item,
        `${prefix}_${index}`,
        output
      );
    });

    return output;
  }

  if (
    typeof value === 'object'
  ) {
    for (
      const [key, child]
      of Object.entries(value)
    ) {
      const normalizedKey =
        normalizarClaveMetrica(key);

      const nextPrefix =
        prefix
          ? `${prefix}_${normalizedKey}`
          : normalizedKey;

      aplanarEspecificaciones(
        child,
        nextPrefix,
        output
      );
    }

    return output;
  }

  if (prefix) {
    output[
      normalizarClaveMetrica(prefix)
    ] = value;
  }

  return output;
}

function buscarEspecificacion(
  especificaciones,
  aliases
) {
  const specs =
    aplanarEspecificaciones(
      especificaciones || {}
    );

  const aliasesNormalizados =
    aliases.map(
      normalizarClaveMetrica
    );

  /*
   * Primero buscamos coincidencia exacta.
   */
  for (
    const alias
    of aliasesNormalizados
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        specs,
        alias
      )
    ) {
      return {
        key: alias,
        value: specs[alias],
      };
    }
  }

  /*
   * Después permitimos claves como:
   * datos_consumo_energia_mensual_kwh
   */
  for (
    const [key, value]
    of Object.entries(specs)
  ) {
    const coincide =
      aliasesNormalizados.some(
        alias =>
          key === alias ||
          key.endsWith(`_${alias}`)
      );

    if (coincide) {
      return {
        key,
        value,
      };
    }
  }

  return null;
}

function obtenerDatoOperacion(
  datos,
  aliases
) {
  const resultado =
    buscarEspecificacion(
      datos,
      aliases
    );

  return numeroFinitoONull(
    resultado?.value
  );
}

function obtenerConsumoEnergiaMensual({
  especificaciones,
  datosActivo,
  consumoIA = null,
  permitirFallbackIA = false,
}) {
  /*
   * 1. Consumo mensual explícito.
   */
  const mensual =
    buscarEspecificacion(
      especificaciones,
      [
        'consumo_energia_mensual_kwh',
        'consumo_mensual_kwh',
        'consumo_energetico_mensual_kwh',
        'energia_mensual_kwh',
        'consumo_minimo_energetico',
        'consumo_mensual_energetico',
        'consumo_energia_mes',
        'consumo_energetico',
        'kwh_mes',
      ]
    );

  const mensualValue =
    numeroFinitoONull(
      mensual?.value
    );

  if (mensualValue !== null) {
    return {
      value: mensualValue,
      fuente:
        `catalogo:${mensual.key}`,
    };
  }

  /*
   * 2. Consumo anual explícito.
   */
  const anual =
    buscarEspecificacion(
      especificaciones,
      [
        'consumo_energia_anual_kwh',
        'consumo_anual_kwh',
        'consumo_energetico_anual_kwh',
        'energia_anual_kwh',
        'kwh_ano',
      ]
    );

  const anualValue =
    numeroFinitoONull(
      anual?.value
    );

  if (anualValue !== null) {
    return {
      value:
        anualValue / 12,
      fuente:
        `catalogo:${anual.key}`,
    };
  }

  /*
   * 3. Potencia × patrón real de uso.
   */
  const potencia =
    buscarEspecificacion(
      especificaciones,
      [
        'potencia_w',
        'potencia_nominal_w',
        'potencia_electrica_w',
        'potencia',
      ]
    );

  let potenciaW =
    numeroFinitoONull(
      potencia?.value
    );

  if (
    potenciaW !== null &&
    potencia?.value
      ?.toString()
      .toLowerCase()
      .includes('kw') &&
    !potencia.value
      .toString()
      .toLowerCase()
      .includes('kwh')
  ) {
    potenciaW *= 1000;
  }

  const horasDia =
    obtenerDatoOperacion(
      datosActivo,
      [
        'horas_uso_dia',
        'horas_uso_diario',
        'horas_dia',
      ]
    );

  const diasMes =
    obtenerDatoOperacion(
      datosActivo,
      [
        'dias_uso_mes',
        'dias_mes',
      ]
    );

  if (
    potenciaW !== null &&
    horasDia !== null &&
    diasMes !== null
  ) {
    return {
      value:
        (
          potenciaW *
          horasDia *
          diasMes
        ) / 1000,

      fuente:
        'calculado:potencia_y_patron_uso',
    };
  }

  /*
   * El consumo calculado por IA solamente
   * puede conservarse cuando la alternativa
   * sigue siendo el producto recomendado
   * originalmente por la IA.
   */
  const consumoIAValue =
    numeroFinitoONull(
      consumoIA
    );

  if (
    permitirFallbackIA &&
    consumoIAValue !== null
  ) {
    return {
      value:
        consumoIAValue,

      fuente:
        'diagnostico_ia',
    };
  }

  return {
    value: null,
    fuente: null,
  };
}

function obtenerConsumoAguaMensual({
  especificaciones,
  datosActivo,
  consumoIA = null,
  permitirFallbackIA = false,
}) {
  /*
   * 1. Consumo mensual en m³.
   */
  const mensual =
    buscarEspecificacion(
      especificaciones,
      [
        'consumo_agua_mensual_m3',
        'consumo_mensual_agua_m3',
        'agua_mensual_m3',
        'm3_mes',
      ]
    );

  const mensualValue =
    numeroFinitoONull(
      mensual?.value
    );

  if (mensualValue !== null) {
    return {
      value: mensualValue,
      fuente:
        `catalogo:${mensual.key}`,
    };
  }

  /*
   * 2. Litros por ciclo.
   */
  const litrosCiclo =
    buscarEspecificacion(
      especificaciones,
      [
        'consumo_agua_ciclo_l',
        'litros_por_ciclo',
        'consumo_por_ciclo_l',
        'agua_por_ciclo_l',
      ]
    );

  const litrosCicloValue =
    numeroFinitoONull(
      litrosCiclo?.value
    );

  const ciclosMes =
    obtenerDatoOperacion(
      datosActivo,
      [
        'ciclos_mes',
        'cantidad_ciclos_mes',
        'usos_mes',
      ]
    );

  if (
    litrosCicloValue !== null &&
    ciclosMes !== null
  ) {
    return {
      value:
        (
          litrosCicloValue *
          ciclosMes
        ) / 1000,

      fuente:
        'calculado:litros_por_ciclo',
    };
  }

  /*
   * 3. Litros por minuto.
   */
  const litrosMinuto =
    buscarEspecificacion(
      especificaciones,
      [
        'consumo_agua_l_min',
        'litros_por_minuto',
        'caudal_l_min',
        'caudal',
      ]
    );

  const litrosMinutoValue =
    numeroFinitoONull(
      litrosMinuto?.value
    );

  const minutosDia =
    obtenerDatoOperacion(
      datosActivo,
      [
        'minutos_uso_dia',
        'minutos_dia',
      ]
    );

  const diasMes =
    obtenerDatoOperacion(
      datosActivo,
      [
        'dias_uso_mes',
        'dias_mes',
      ]
    );

  if (
    litrosMinutoValue !== null &&
    minutosDia !== null &&
    diasMes !== null
  ) {
    return {
      value:
        (
          litrosMinutoValue *
          minutosDia *
          diasMes
        ) / 1000,

      fuente:
        'calculado:caudal_y_patron_uso',
    };
  }

  const consumoIAValue =
    numeroFinitoONull(
      consumoIA
    );

  if (
    permitirFallbackIA &&
    consumoIAValue !== null
  ) {
    return {
      value:
        consumoIAValue,

      fuente:
        'diagnostico_ia',
    };
  }

  return {
    value: null,
    fuente: null,
  };
}

function diferenciaONull(
  actual,
  proyectado
) {
  const actualValue =
    numeroFinitoONull(actual);

  const proyectadoValue =
    numeroFinitoONull(proyectado);

  if (
    actualValue === null ||
    proyectadoValue === null
  ) {
    return null;
  }

  return (
    actualValue -
    proyectadoValue
  );
}

function calcularMetricasAlternativa({
  metricasOriginales = {},
  alternativa,
  datosActivo = {},
  costoUnitarioEnergia = null,
  costoUnitarioAgua = null,
  idItemRecomendadoIA = null,
}) {
  const cantidad =
    numeroFinitoONull(
      alternativa
        ?.cantidad_activo
    ) ?? 1;

  const precioUnitario =
    numeroFinitoONull(
      alternativa
        ?.precio_base
    );

  const inversion =
    precioUnitario === null
      ? null
      : precioUnitario *
        cantidad;

  const mismoProductoIA =
    Number(
      alternativa?.id_item
    ) ===
    Number(
      idItemRecomendadoIA
    );

  const energiaProyectada =
    obtenerConsumoEnergiaMensual({
      especificaciones:
        alternativa
          ?.especificaciones,

      datosActivo,

      consumoIA:
        metricasOriginales
          ?.consumo_energia_proyectado_mes,

      permitirFallbackIA:
        mismoProductoIA,
    });

  const aguaProyectada =
    obtenerConsumoAguaMensual({
      especificaciones:
        alternativa
          ?.especificaciones,

      datosActivo,

      consumoIA:
        metricasOriginales
          ?.consumo_agua_proyectado_mes,

      permitirFallbackIA:
        mismoProductoIA,
    });

  const energiaActual =
    numeroFinitoONull(
      metricasOriginales
        ?.consumo_energia_actual_mes
    );

  const aguaActual =
    numeroFinitoONull(
      metricasOriginales
        ?.consumo_agua_actual_mes
    );

  const energiaNueva =
    energiaProyectada.value;

  const aguaNueva =
    aguaProyectada.value;

  const costoEnergia =
    numeroFinitoONull(
      costoUnitarioEnergia
    );

  const costoAgua =
    numeroFinitoONull(
      costoUnitarioAgua
    );

  const costoActualEnergia =
    energiaActual !== null &&
    costoEnergia !== null
      ? energiaActual *
        costoEnergia
      : null;

  const costoNuevoEnergia =
    energiaNueva !== null &&
    costoEnergia !== null
      ? energiaNueva *
        costoEnergia
      : null;

  const costoActualAgua =
    aguaActual !== null &&
    costoAgua !== null
      ? aguaActual *
        costoAgua
      : null;

  const costoNuevoAgua =
    aguaNueva !== null &&
    costoAgua !== null
      ? aguaNueva *
        costoAgua
      : null;

  const costosActualesConocidos = [
    costoActualEnergia,
    costoActualAgua,
  ].filter(
    value => value !== null
  );

  const costosNuevosConocidos = [
    costoNuevoEnergia,
    costoNuevoAgua,
  ].filter(
    value => value !== null
  );

  const costoActualMes =
    costosActualesConocidos.length > 0
      ? costosActualesConocidos.reduce(
          (sum, value) =>
            sum + value,
          0
        )
      : null;

  const costoProyectadoMes =
    costosNuevosConocidos.length > 0
      ? costosNuevosConocidos.reduce(
          (sum, value) =>
            sum + value,
          0
        )
      : null;

  const ahorrosConocidos = [];

  if (
    costoActualEnergia !== null &&
    costoNuevoEnergia !== null
  ) {
    ahorrosConocidos.push(
      costoActualEnergia -
      costoNuevoEnergia
    );
  }

  if (
    costoActualAgua !== null &&
    costoNuevoAgua !== null
  ) {
    ahorrosConocidos.push(
      costoActualAgua -
      costoNuevoAgua
    );
  }

  const ahorroMensual =
    ahorrosConocidos.length > 0
      ? ahorrosConocidos.reduce(
          (sum, value) =>
            sum + value,
          0
        )
      : null;

  const reduccionEnergia =
    diferenciaONull(
      energiaActual,
      energiaNueva
    );

  const reduccionAgua =
    diferenciaONull(
      aguaActual,
      aguaNueva
    );

  const reduccionCarbono =
    reduccionEnergia === null
      ? null
      : reduccionEnergia *
        FACTOR_CO2_KG_POR_KWH;

  const roi5Anios =
    inversion !== null &&
    inversion > 0 &&
    ahorroMensual !== null
      ? (
          (
            ahorroMensual *
            MESES_PROYECCION_ROI -
            inversion
          ) /
          inversion
        ) * 100
      : null;

  const payback =
    inversion !== null &&
    inversion > 0 &&
    ahorroMensual !== null &&
    ahorroMensual > 0
      ? inversion /
        ahorroMensual
      : null;

  return {
    consumo_energia_actual_mes:
      energiaActual,

    consumo_energia_proyectado_mes:
      energiaNueva,

    consumo_agua_actual_mes:
      aguaActual,

    consumo_agua_proyectado_mes:
      aguaNueva,

    costo_actual_mes:
      costoActualMes,

    costo_proyectado_mes:
      costoProyectadoMes,

    ahorro_economico_mensual:
      ahorroMensual,

    inversion_total_requerida:
      inversion,

    reduccion_energia:
      reduccionEnergia,

    reduccion_agua:
      reduccionAgua,

    reduccion_carbono:
      reduccionCarbono,

    roi_5_anios:
      roi5Anios,

    payback,

    fuentes_calculo: {
      energia_proyectada:
        energiaProyectada.fuente,

      agua_proyectada:
        aguaProyectada.fuente,

      costo_unitario_energia:
        costoEnergia !== null
          ? 'ultima_factura'
          : null,

      costo_unitario_agua:
        costoAgua !== null
          ? 'ultima_factura'
          : null,

      factor_co2:
        FACTOR_CO2_KG_POR_KWH,
    },

    calculable: {
      energia:
        energiaActual !== null &&
        energiaNueva !== null,

      agua:
        aguaActual !== null &&
        aguaNueva !== null,

      ahorro:
        ahorroMensual !== null,

      roi:
        roi5Anios !== null,

      payback:
        payback !== null,
    },
  };
}

function sumarMetricaCompleta(
  alternativas,
  campo
) {
  if (
    !Array.isArray(alternativas) ||
    alternativas.length === 0
  ) {
    return null;
  }

  const valores =
    alternativas.map(
      alternativa =>
        numeroFinitoONull(
          alternativa
            ?.metricas
            ?.[campo]
        )
    );

  /*
   * Si un activo no tiene la métrica,
   * no mostramos un total incompleto
   * como si fuera el total real.
   */
  if (
    valores.some(
      value => value === null
    )
  ) {
    return null;
  }

  return valores.reduce(
    (sum, value) =>
      sum + value,
    0
  );
}

function calcularResumenAlternativas(
  alternativas
) {
  const consumoEnergiaActual =
    sumarMetricaCompleta(
      alternativas,
      'consumo_energia_actual_mes'
    );

  const consumoEnergiaProyectado =
    sumarMetricaCompleta(
      alternativas,
      'consumo_energia_proyectado_mes'
    );

  const consumoAguaActual =
    sumarMetricaCompleta(
      alternativas,
      'consumo_agua_actual_mes'
    );

  const consumoAguaProyectado =
    sumarMetricaCompleta(
      alternativas,
      'consumo_agua_proyectado_mes'
    );

  const costoActual =
    sumarMetricaCompleta(
      alternativas,
      'costo_actual_mes'
    );

  const costoProyectado =
    sumarMetricaCompleta(
      alternativas,
      'costo_proyectado_mes'
    );

  const ahorroMensual =
    sumarMetricaCompleta(
      alternativas,
      'ahorro_economico_mensual'
    );

  const inversion =
    sumarMetricaCompleta(
      alternativas,
      'inversion_total_requerida'
    );

  const reduccionEnergia =
    sumarMetricaCompleta(
      alternativas,
      'reduccion_energia'
    );

  const reduccionAgua =
    sumarMetricaCompleta(
      alternativas,
      'reduccion_agua'
    );

  const reduccionCarbono =
    sumarMetricaCompleta(
      alternativas,
      'reduccion_carbono'
    );

  const roi =
    inversion !== null &&
    inversion > 0 &&
    ahorroMensual !== null
      ? (
          (
            ahorroMensual *
            MESES_PROYECCION_ROI -
            inversion
          ) /
          inversion
        ) * 100
      : null;

  const payback =
    inversion !== null &&
    inversion > 0 &&
    ahorroMensual !== null &&
    ahorroMensual > 0
      ? inversion /
        ahorroMensual
      : null;

  const activosConMetricasCompletas =
    alternativas.filter(
      alternativa =>
        alternativa
          ?.metricas
          ?.calculable
          ?.ahorro === true
    ).length;

  return {
    cantidad:
      alternativas.length,

    consumo_energia_actual_mes:
      consumoEnergiaActual,

    consumo_energia_proyectado_mes:
      consumoEnergiaProyectado,

    consumo_agua_actual_mes:
      consumoAguaActual,

    consumo_agua_proyectado_mes:
      consumoAguaProyectado,

    costo_actual_mes:
      costoActual,

    costo_proyectado_mes:
      costoProyectado,

    ahorro_economico_mensual:
      ahorroMensual,

    inversion_total_requerida:
      inversion,

    reduccion_energia:
      reduccionEnergia,

    reduccion_agua:
      reduccionAgua,

    reduccion_carbono:
      reduccionCarbono,

    roi,

    payback,

    cobertura_calculo: {
      activos_seleccionados:
        alternativas.length,

      activos_con_metricas_completas:
        activosConMetricasCompletas,

      completa:
        alternativas.length > 0 &&
        activosConMetricasCompletas ===
          alternativas.length,
    },

    calculado_at:
      new Date().toISOString(),

    calculado_por:
      'backend',
  };
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
    Number(
      req.user?.id_usuario
    );

  try {
    if (
      !Number.isInteger(
        idUsuario
      )
    ) {
      return res.status(401).json({
        error:
          'Usuario no autenticado',
      });
    }

    /*
     * La relación mipyme_usuario garantiza
     * que el cliente solamente pueda
     * consultar información de su empresa.
     */
    const mipymeResult =
      await pool.query(
        `
        SELECT
          m.id_mipyme,
          m.nombre_mipyme,
          m.nit,
          m.municipio
        FROM mipyme_usuario mu
        INNER JOIN mipyme m
          ON m.id_mipyme =
             mu.id_mipyme
        WHERE mu.id_usuario = $1
          AND COALESCE(
            m.estado,
            'activo'
          ) != 'eliminado'
        ORDER BY
          mu.id_mipyme ASC
        LIMIT 1
        `,
        [
          idUsuario
        ]
      );

    if (
      mipymeResult.rows.length === 0
    ) {
      return res.status(404).json({
        error:
          'No se encontró una empresa asociada al usuario',
      });
    }

    const mipyme =
      mipymeResult.rows[0];

    /*
     * Esta es la función correcta.
     * Devuelve los diagnósticos ordenados
     * desde el más reciente.
     */
    const diagnosticosOriginales =
      await construirDiagnosticosCompletos(
        mipyme.id_mipyme
      );

    /*
     * Añadimos un estado de presentación
     * sin modificar la estructura guardada.
     */
    const diagnosticos =
      diagnosticosOriginales.map(
        diagnostico => {
          const metricas =
            diagnostico.metricas &&
            typeof diagnostico.metricas ===
              'object'
              ? diagnostico.metricas
              : {};

          const activosSeleccionados =
            Array.isArray(
              metricas
                .activos_seleccionados
            )
              ? metricas
                  .activos_seleccionados
              : [];

          const alternativasSeleccionadas =
            Array.isArray(
              metricas
                .alternativas_seleccionadas
            )
              ? metricas
                  .alternativas_seleccionadas
              : [];

          const tieneSeleccion =
            activosSeleccionados.length >
              0 &&
            alternativasSeleccionadas.length >
              0;

          return {
            ...diagnostico,

            estado_propuesta:
              tieneSeleccion
                ? 'seleccion_guardada'
                : 'recomendacion_generada',

            cantidad_activos_propuestos:
              activosSeleccionados.length,

            cantidad_alternativas_seleccionadas:
              alternativasSeleccionadas
                .length,
          };
        }
      );

    const propuestaActual =
      diagnosticos.length > 0
        ? diagnosticos[0]
        : null;

    return res.status(200).json({
      empresa: {
        id_mipyme:
          Number(
            mipyme.id_mipyme
          ),

        nombre:
          mipyme.nombre_mipyme,

        nit:
          mipyme.nit,

        municipio:
          mipyme.municipio,
      },

      total_diagnosticos:
        diagnosticos.length,

      /*
       * Mantiene compatibilidad con el
       * frontend anterior.
       */
      diagnosticos,

      /*
       * Será la fuente principal de la
       * nueva pantalla Mi propuesta.
       */
      propuesta_actual:
        propuestaActual,
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    console.error(
      'Error getMisDiagnosticos:',
      err
    );

    return res.status(500).json({
      error:
        'No fue posible obtener la propuesta del cliente',
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
    i.id_item,
    i.tipo_item,
    i.nombre,
    i.descripcion,
    i.especificaciones,
    i.precio_base,
    i.disponible,
    i.id_proveedor,
    i.url_origen,

    p.razon_social
      AS nombre_proveedor,

    p.nit
      AS nit_proveedor,

    p.calificacion
      AS calificacion_proveedor

  FROM item_catalogo i

  INNER JOIN proveedor p
    ON p.id_proveedor =
       i.id_proveedor

  WHERE i.disponible = true

    AND COALESCE(
      i.estado,
      'activo'
    ) = 'activo'

    AND COALESCE(
      p.estado,
      'activo'
    ) = 'activo'

    AND EXISTS (
      SELECT 1
      FROM unnest(
        $1::text[]
      ) categoria
      WHERE LOWER(
        TRIM(
          COALESCE(
            i.tipo_item,
            ''
          )
        )
      ) = categoria
    )

  ORDER BY
    p.calificacion
      DESC NULLS LAST,

    i.precio_base
      ASC NULLS LAST,

    i.nombre ASC
  `,
  [
    categorias
  ]
);

  return result.rows;

}

async function getAlternativasActivoDiagnostico(
  req,
  res
) {

  const idDiagnostico =
    Number(
      req.params.idDiagnostico
    );

  const idActivo =
    Number(
      req.params.idActivo
    );

  try {

    if (
      !Number.isInteger(idDiagnostico) ||
      !Number.isInteger(idActivo)
    ) {
      return res.status(400).json({
        error:
          'El diagnóstico y el activo deben ser numéricos',
      });
    }

    /*
     * Confirmamos que el diagnóstico y el
     * activo existen y pertenecen a la
     * misma Mipyme.
     */
    const contextoResult =
      await pool.query(
        `
        SELECT
          d.id_diagnostico,
          d.id_mipyme,
          d.metricas AS metricas_diagnostico,

          a.id_activo,
          a.nombre AS nombre_activo,
          a.tipo AS tipo_activo,
          a.marca AS marca_activo,
          a.modelo AS modelo_activo,
          a.descripcion AS descripcion_activo,
          a.datos AS datos_activo,
          a.cantidad AS cantidad_activo
        FROM diagnostico d
        INNER JOIN activo a
          ON a.id_mipyme = d.id_mipyme
        WHERE d.id_diagnostico = $1
          AND a.id_activo = $2
          AND COALESCE(
            d.estado,
            'activo'
          ) != 'eliminado'
        LIMIT 1
        `,
        [
          idDiagnostico,
          idActivo,
        ]
      );

    if (
      contextoResult.rows.length === 0
    ) {
      return res.status(404).json({
        error:
          'No se encontró el activo dentro del diagnóstico indicado',
      });
    }

    const activo =
      contextoResult.rows[0];

    await requireMipymeAccess(
      pool,
      req.user?.id_usuario,
      activo.id_mipyme,
    );

    const metricasDiagnostico =
      activo.metricas_diagnostico &&
      typeof activo.metricas_diagnostico ===
        'object'
        ? activo.metricas_diagnostico
        : {};

    const activosDiagnostico =
      Array.isArray(
        metricasDiagnostico.activos
      )
        ? metricasDiagnostico.activos
        : [];

    const activoDiagnostico =
      activosDiagnostico.find(
        item =>
          Number(
            item?.id_activo
          ) ===
          Number(
            activo.id_activo
          )
      );

    if (!activoDiagnostico) {
      return res.status(400).json({
        error:
          'No se encontraron las métricas originales del activo dentro del diagnóstico',
      });
    }

    const metricasOriginales =
      activoDiagnostico.metricas &&
      typeof activoDiagnostico.metricas ===
        'object'
        ? activoDiagnostico.metricas
        : {};

    const idItemRecomendadoIA =
      activoDiagnostico
        ?.producto_recomendado
        ?.id_item ?? null;

    if (!activo.tipo_activo) {
      return res.status(400).json({
        error:
          'El activo no tiene un tipo definido',
      });
    }

    /*
    * Costos unitarios más recientes para
    * calcular los beneficios financieros
    * de cada alternativa.
    */
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
        [
          activo.id_mipyme
        ]
      );

    let costoUnitarioEnergia = null;
    let costoUnitarioAgua = null;

    for (
      const consumo
      of costosResult.rows
    ) {
      const tipo =
        normalizeText(
          consumo.tipo
        );

      if (
        costoUnitarioEnergia === null &&
        tipo.includes('energia')
      ) {
        costoUnitarioEnergia =
          numeroFinitoONull(
            consumo.costo_unitario
          );
      }

      if (
        costoUnitarioAgua === null &&
        tipo.includes('agua')
      ) {
        costoUnitarioAgua =
          numeroFinitoONull(
            consumo.costo_unitario
          );
      }

      if (
        costoUnitarioEnergia !== null &&
        costoUnitarioAgua !== null
      ) {
        break;
      }
    }

    /*
     * Consultamos productos disponibles
     * del mismo tipo y añadimos los datos
     * comerciales del proveedor.
     */
    const alternativasResult =
      await pool.query(
        `
        SELECT
          i.id_item,
          i.tipo_item,
          i.nombre,
          i.descripcion,
          i.especificaciones,
          i.precio_base,
          i.disponible,
          i.id_proveedor,
          i.url_origen,

          p.razon_social
            AS nombre_proveedor,

          p.nit
            AS nit_proveedor,

          p.calificacion
            AS calificacion_proveedor

        FROM item_catalogo i

        INNER JOIN proveedor p
          ON p.id_proveedor =
             i.id_proveedor

        WHERE i.disponible = true

          AND COALESCE(
            i.estado,
            'activo'
          ) = 'activo'

          AND COALESCE(
            p.estado,
            'activo'
          ) = 'activo'

          AND LOWER(
            TRIM(
              COALESCE(
                i.tipo_item,
                ''
              )
            )
          ) = LOWER(
            TRIM($1)
          )

        ORDER BY
          p.calificacion DESC NULLS LAST,
          i.precio_base ASC NULLS LAST,
          i.nombre ASC
        `,
        [
          activo.tipo_activo,
        ]
      );

    const alternativas =
      alternativasResult.rows.map(
        item => {
          const cantidadActivo =
            numeroFinitoONull(
              activo.cantidad_activo
            ) ?? 1;

          const alternativa = {
            id_item:
              Number(
                item.id_item
              ),

            id_activo:
              Number(
                activo.id_activo
              ),

            tipo_item:
              item.tipo_item,

            nombre:
              item.nombre,

            descripcion:
              item.descripcion,

            especificaciones:
              item.especificaciones,

            precio_base:
              numeroFinitoONull(
                item.precio_base
              ),

            disponible:
              item.disponible,

            url_origen:
              item.url_origen,

            cantidad_activo:
              cantidadActivo,

            /*
            * Si coincide con la recomendación
            * original, conservamos la fuente IA.
            * Las demás opciones aún no han sido
            * elegidas por el usuario.
            */
            fuente:
              Number(
                item.id_item
              ) ===
              Number(
                idItemRecomendadoIA
              )
                ? 'ia'
                : 'catalogo',

            recomendada_por_ia:
              Number(
                item.id_item
              ) ===
              Number(
                idItemRecomendadoIA
              ),

            proveedor: {
              id_proveedor:
                Number(
                  item.id_proveedor
                ),

              nombre:
                item.nombre_proveedor,

              nit:
                item.nit_proveedor,

              calificacion:
                item.calificacion_proveedor,
            },
          };

          alternativa.metricas =
            calcularMetricasAlternativa({
              metricasOriginales,

              alternativa,

              datosActivo:
                activo.datos_activo ?? {},

              costoUnitarioEnergia,

              costoUnitarioAgua,

              idItemRecomendadoIA,
            });

          return alternativa;
        }
      );

    return res.status(200).json({
      activo: {
        id_activo:
          activo.id_activo,

        nombre:
          activo.nombre_activo,

        tipo:
          activo.tipo_activo,

        marca:
          activo.marca_activo,

        modelo:
          activo.modelo_activo,

        descripcion:
          activo.descripcion_activo,

        datos:
          activo.datos_activo,

        cantidad:
        Number(
          activo.cantidad_activo ?? 1
        ),
        metricas_originales:
          metricasOriginales,

        producto_recomendado_ia:
          activoDiagnostico
            .producto_recomendado ??
          null,
      },

      total_alternativas:
        alternativas.length,
      
      costos_unitarios: {
        energia:
          costoUnitarioEnergia,

        agua:
          costoUnitarioAgua,
      },

      factor_co2:
        FACTOR_CO2_KG_POR_KWH,

      alternativas,
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }

    console.error(
      'Error obteniendo alternativas del activo:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al obtener las alternativas',
    });

  }

}

async function guardarSeleccionActivos(
  req,
  res
) {

  const idDiagnostico =
    Number(
      req.params.idDiagnostico
    );

  const {
    activos_seleccionados = [],
    alternativas_seleccionadas = [],
    resumen_seleccionado = null,
  } = req.body;

  try {

    if (
      !Number.isInteger(
        idDiagnostico
      )
    ) {
      return res.status(400).json({
        error:
          'El diagnóstico debe ser numérico',
      });
    }

    if (
      !Array.isArray(
        activos_seleccionados
      )
    ) {
      return res.status(400).json({
        error:
          'activos_seleccionados debe ser una lista',
      });
    }

    if (
      !Array.isArray(
        alternativas_seleccionadas
      )
    ) {
      return res.status(400).json({
        error:
          'alternativas_seleccionadas debe ser una lista',
      });
    }

    /*
     * Normalizamos los activos y quitamos
     * IDs repetidos o inválidos.
     */
    const idsActivos = [
      ...new Set(
        activos_seleccionados
          .map(Number)
          .filter(Number.isInteger)
      )
    ];

    const diagnosticoResult =
      await pool.query(
        `
        SELECT
          id_diagnostico,
          id_mipyme,
          metricas
        FROM diagnostico
        WHERE id_diagnostico = $1
          AND COALESCE(
            estado,
            'activo'
          ) != 'eliminado'
        `,
        [
          idDiagnostico
        ]
      );

    if (
      diagnosticoResult
        .rows
        .length === 0
    ) {
      return res.status(404).json({
        error:
          'Diagnóstico no encontrado',
      });
    }

    const diagnostico =
      diagnosticoResult.rows[0];

    await requireMipymeAccess(
      pool,
      req.user?.id_usuario,
      diagnostico.id_mipyme,
    );

    /*
    * Métricas originales del diagnóstico.
    * Contienen la línea base del activo y
    * la recomendación inicial de la IA.
    */
    const metricasDiagnostico =
      diagnostico.metricas &&
      typeof diagnostico.metricas ===
        'object'
        ? diagnostico.metricas
        : {};

    const activosDiagnostico =
      Array.isArray(
        metricasDiagnostico.activos
      )
        ? metricasDiagnostico.activos
        : [];

    /*
    * Consultamos los costos unitarios más
    * recientes. Estos valores no se reciben
    * desde Flutter.
    */
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
        [
          diagnostico.id_mipyme
        ]
      );

    let costoUnitarioEnergia = null;
    let costoUnitarioAgua = null;

    for (
      const consumo
      of costosResult.rows
    ) {
      const tipo =
        normalizeText(
          consumo.tipo
        );

      if (
        costoUnitarioEnergia === null &&
        tipo.includes('energia')
      ) {
        costoUnitarioEnergia =
          numeroFinitoONull(
            consumo.costo_unitario
          );
      }

      if (
        costoUnitarioAgua === null &&
        tipo.includes('agua')
      ) {
        costoUnitarioAgua =
          numeroFinitoONull(
            consumo.costo_unitario
          );
      }

      if (
        costoUnitarioEnergia !== null &&
        costoUnitarioAgua !== null
      ) {
        break;
      }
    }

    /*
     * Validamos que los activos realmente
     * pertenezcan a la Mipyme del
     * diagnóstico.
     */
    if (idsActivos.length > 0) {

      const activosResult =
        await pool.query(
          `
          SELECT id_activo
          FROM activo
          WHERE id_mipyme = $1
            AND id_activo =
                ANY($2::int[])
          `,
          [
            diagnostico.id_mipyme,
            idsActivos,
          ]
        );

      const activosEncontrados =
        activosResult.rows.map(
          row =>
            Number(
              row.id_activo
            )
        );

      const activosInvalidos =
        idsActivos.filter(
          id =>
            !activosEncontrados
              .includes(id)
        );

      if (
        activosInvalidos.length > 0
      ) {
        return res.status(400).json({
          error:
            'Uno o más activos no pertenecen a la Mipyme del diagnóstico',

          activos_invalidos:
            activosInvalidos,
        });
      }
    }

    /*
     * No confiamos en nombres, precios ni
     * proveedor enviados por Flutter.
     * Consultamos nuevamente cada producto
     * y creamos una fotografía confiable.
     */
    const alternativasValidadas = [];

    for (const seleccion of alternativas_seleccionadas) {

      const idActivo =
        Number(
          seleccion?.id_activo
        );

      const idItem =
        Number(
          seleccion?.id_item
        );

      const fuente =
        seleccion?.fuente === 'ia'
          ? 'ia'
          : 'usuario';

      if (
        !Number.isInteger(idActivo) ||
        !Number.isInteger(idItem)
      ) {
        return res.status(400).json({
          error:
            'Cada alternativa debe contener id_activo e id_item válidos',
        });
      }

      if (
        !idsActivos.includes(
          idActivo
        )
      ) {
        return res.status(400).json({
          error:
            `El activo ${idActivo} tiene una alternativa, pero no está incluido en la propuesta`,
        });
      }

      const alternativaResult =
        await pool.query(
          `
          SELECT
            a.id_activo,
            a.nombre
              AS nombre_activo,
            a.tipo
              AS tipo_activo,
            a.cantidad,
            a.datos AS datos_activo,

            i.id_item,
            i.tipo_item,
            i.nombre
              AS nombre_producto,
            i.descripcion,
            i.especificaciones,
            i.precio_base,
            i.url_origen,
            i.id_proveedor,

            p.razon_social
              AS nombre_proveedor,
            p.nit
              AS nit_proveedor,
            p.calificacion
              AS calificacion_proveedor

          FROM activo a

          INNER JOIN diagnostico d
            ON d.id_mipyme =
               a.id_mipyme

          INNER JOIN item_catalogo i
            ON LOWER(
                 TRIM(
                   COALESCE(
                     i.tipo_item,
                     ''
                   )
                 )
               )
               =
               LOWER(
                 TRIM(
                   COALESCE(
                     a.tipo,
                     ''
                   )
                 )
               )

          INNER JOIN proveedor p
            ON p.id_proveedor =
               i.id_proveedor

          WHERE d.id_diagnostico = $1
            AND a.id_activo = $2
            AND i.id_item = $3
            AND i.disponible = true
            AND COALESCE(
              i.estado,
              'activo'
            ) = 'activo'
            AND COALESCE(
              p.estado,
              'activo'
            ) = 'activo'

          LIMIT 1
          `,
          [
            idDiagnostico,
            idActivo,
            idItem,
          ]
        );

      if (
        alternativaResult
          .rows
          .length === 0
      ) {
        return res.status(400).json({
          error:
            `La alternativa seleccionada para el activo ${idActivo} no está disponible o no es compatible`,
        });
      }

      const item =
        alternativaResult.rows[0];

      const activoDiagnostico =
        activosDiagnostico.find(
          activo =>
            Number(
              activo?.id_activo
            ) ===
            Number(
              item.id_activo
            )
        );

      if (!activoDiagnostico) {
        return res.status(400).json({
          error:
            `No se encontraron las métricas originales del activo ${item.id_activo}`,
        });
      }

      const alternativaValidada = {
        id_activo:
          Number(
            item.id_activo
          ),

        nombre_activo:
          item.nombre_activo,

        tipo_activo:
          item.tipo_activo,

        cantidad_activo:
          Number(
            item.cantidad ?? 1
          ),

        id_item:
          Number(
            item.id_item
          ),

        fuente,

        tipo_item:
          item.tipo_item,

        nombre:
          item.nombre_producto,

        descripcion:
          item.descripcion,

        especificaciones:
          item.especificaciones,

        precio_base:
          numeroFinitoONull(
            item.precio_base
          ),

        url_origen:
          item.url_origen,

        proveedor: {
          id_proveedor:
            Number(
              item.id_proveedor
            ),

          nombre:
            item.nombre_proveedor,

          nit:
            item.nit_proveedor,

          calificacion:
            item.calificacion_proveedor,
        },

        seleccionado_at:
          new Date().toISOString(),

        seleccionado_by:
          req.user.id_usuario,
      };

      /*
      * El ID recomendado inicialmente permite
      * conservar las métricas de la IA únicamente
      * cuando continúa seleccionado ese producto.
      */
      const idItemRecomendadoIA =
        activoDiagnostico
          ?.producto_recomendado
          ?.id_item ?? null;

      alternativaValidada.metricas =
        calcularMetricasAlternativa({
          metricasOriginales:
            activoDiagnostico
              ?.metricas ?? {},

          alternativa:
            alternativaValidada,

          datosActivo:
            item.datos_activo ?? {},

          costoUnitarioEnergia,

          costoUnitarioAgua,

          idItemRecomendadoIA,
        });

      alternativasValidadas.push(
        alternativaValidada
      );
    }

    const idsAlternativas =
      alternativasValidadas.map(
        alternativa =>
          Number(
            alternativa.id_activo
          )
      );

    const idsAlternativasUnicas =
      new Set(
        idsAlternativas
      );

    if (
      idsAlternativasUnicas.size !==
      idsAlternativas.length
    ) {
      return res.status(400).json({
        error:
          'Un activo no puede tener más de una alternativa seleccionada',
      });
    }

    /*
    * Todos los activos incluidos deben
    * tener exactamente una alternativa.
    */
    const idsConAlternativa =
      alternativasValidadas.map(
        alternativa =>
          Number(
            alternativa.id_activo
          )
      );

    const activosSinAlternativa =
      idsActivos.filter(
        idActivo =>
          !idsConAlternativa.includes(
            idActivo
          )
      );

    if (
      activosSinAlternativa.length > 0
    ) {
      return res.status(400).json({
        error:
          'Todos los activos incluidos deben tener una alternativa seleccionada',

        activos_sin_alternativa:
          activosSinAlternativa,
      });
    }

    const resumenCalculado =
      calcularResumenAlternativas(
        alternativasValidadas
      );

    const metricas = {
      ...metricasDiagnostico,

      activos_seleccionados:
        idsActivos,

      alternativas_seleccionadas:
        alternativasValidadas,

      resumen_seleccionado:
        resumenCalculado,
    };

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
          idDiagnostico,
        ]
      );

    return res.status(200).json({
      message:
        'Selección y alternativas guardadas correctamente',

      diagnostico:
        updated.rows[0],
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }

    console.error(
      'Error guardando selección del diagnóstico:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al guardar la selección',
    });
  }
}

module.exports = {
  generarYSyncDiagnosticos,
  getMisDiagnosticos,
  construirDiagnosticosCompletos,
  getAlternativasActivoDiagnostico,
  guardarSeleccionActivos,
};