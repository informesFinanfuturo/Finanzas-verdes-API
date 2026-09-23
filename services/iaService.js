const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { text } = require('stream/consumers');
const { fromPath } = require("pdf2pic");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const model = 'gemini-3.5-flash-lite';
const backupModel = 'gemini-3.1-flash-lite';

const PRIMARY_TIMEOUT_MS = 45_000;
const BACKUP_TIMEOUT_MS = 90_000;
const FORCE_AI_FALLBACK = process.env.FORCE_AI_FALLBACK == 'true';

function detectMimeType(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();

  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';

  return 'image/jpeg';
}

function cleanAIResponse(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

class AIRequestTimeoutError
  extends Error {

  constructor(modelo, timeoutMs) {
    super(
      `El modelo ${modelo} superó el tiempo máximo de ${timeoutMs} ms`
    );

    this.name =
      'AIRequestTimeoutError';

    this.code =
      'AI_TIMEOUT';

    this.modelo =
      modelo;

    this.timeoutMs =
      timeoutMs;
  }

}


function obtenerEstadoError(error) {

  return Number(
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status ??
    0
  );

}


function debeUsarBackup(error) {

  const status =
    obtenerEstadoError(error);

  const code =
    String(
      error?.code ??
      error?.cause?.code ??
      ''
    ).toUpperCase();

  const message =
    String(
      error?.message ??
      error?.cause?.message ??
      ''
    ).toLowerCase();

  const estadosTemporales = [
    408,
    429,
    500,
    502,
    503,
    504,
  ];

  const codigosTemporales = [
    'AI_TIMEOUT',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNABORTED',
    'ECONNRESET',
    'RESOURCE_EXHAUSTED',
    'DEADLINE_EXCEEDED',
    'SERVICE_UNAVAILABLE',
    'MODEL_OVERLOADED',
    'UNAVAILABLE',
  ];

  const mensajesTemporales = [
    'timeout',
    'time out',
    'timed out',
    'deadline exceeded',
    'queue',
    'queued',
    'cola',
    'overloaded',
    'sobrecargado',
    'temporarily unavailable',
    'service unavailable',
    'resource exhausted',
    'rate limit',
    'too many requests',
  ];

  return (
    estadosTemporales.includes(status) ||
    codigosTemporales.includes(code) ||
    mensajesTemporales.some(
      texto =>
        message.includes(texto)
    )
  );

}


async function ejecutarConTimeout({
  operation,
  modelo,
  timeoutMs,
}) {

  const abortController =
    new AbortController();

  let timeoutId;

  const timeoutPromise =
    new Promise((_, reject) => {

      timeoutId =
        setTimeout(() => {

          abortController.abort();

          reject(
            new AIRequestTimeoutError(
              modelo,
              timeoutMs
            )
          );

        }, timeoutMs);

    });

  try {

    return await Promise.race([
      operation(
        modelo,
        abortController.signal
      ),
      timeoutPromise,
    ]);

  } finally {

    clearTimeout(timeoutId);

  }

}


async function ejecutarConFallback({
  operation,
  modeloPrincipal = model,
}) {
  try {
    console.log(
      `[IA] Intentando con modelo principal: ${modeloPrincipal}`
    );

    /*
     * Simulación de timeout.
     * Debe ejecutarse antes de llamar
     * realmente al modelo principal.
     */
    if (FORCE_AI_FALLBACK) {
      console.warn(
        '[IA] Simulando timeout del modelo principal'
      );

      const simulatedError =
        new Error(
          'Timeout simulado del modelo principal'
        );

      simulatedError.code =
        'AI_TIMEOUT';

      simulatedError.modelo =
        modeloPrincipal;

      throw simulatedError;
    }

    const result =
      await ejecutarConTimeout({
        operation,
        modelo:
          modeloPrincipal,
        timeoutMs:
          PRIMARY_TIMEOUT_MS,
      });

    console.log(
      `[IA] Respuesta obtenida con: ${modeloPrincipal}`
    );

    return result;
  } catch (primaryError) {
    console.error(
      `[IA] Falló el modelo principal ${modeloPrincipal}:`,
      {
        status:
          obtenerEstadoError(
            primaryError
          ),

        code:
          primaryError?.code,

        message:
          primaryError?.message,
      }
    );

    /*
     * Evita llamar nuevamente al backup
     * si este ya era el modelo solicitado.
     */
    if (
      modeloPrincipal ===
      backupModel
    ) {
      throw primaryError;
    }

    /*
     * Solo hacemos fallback ante errores
     * temporales, saturación o timeout.
     */
    if (
      !debeUsarBackup(
        primaryError
      )
    ) {
      throw primaryError;
    }

    console.warn(
      `[IA] Cambiando al modelo backup: ${backupModel}`
    );

    try {
      const result =
        await ejecutarConTimeout({
          operation,
          modelo:
            backupModel,
          timeoutMs:
            BACKUP_TIMEOUT_MS,
        });

      console.log(
        `[IA] Respuesta obtenida con el backup: ${backupModel}`
      );

      return result;
    } catch (backupError) {
      console.error(
        `[IA] También falló el modelo backup ${backupModel}:`,
        {
          status:
            obtenerEstadoError(
              backupError
            ),

          code:
            backupError?.code,

          message:
            backupError?.message,
        }
      );

      throw backupError;
    }
  }
}


/// SOLO TEXTO CON TIMEOUT Y FALLBACK
async function askAI(
  prompt,
  modelo = model
) {
  return ejecutarConFallback({
    modeloPrincipal: modelo,

    operation: async (
      selectedModel,
      abortSignal
    ) => {
      const response =
        await ai.models.generateContent({
          model: selectedModel,
          contents: prompt,

          config: {
            abortSignal,
          },
        });

      console.log(
        '===== GEMINI TEXTO ====='
      );

      console.log(
        `Modelo utilizado: ${selectedModel}`
      );

      console.log(
        response.text
      );

      return response.text;
    },
  });
}

/// ✅ SOLO TEXTO
// async function askAI(prompt, modelo) {
//   try {
//     const response = await ai.models.generateContent({
//       model: modelo,
//       contents: prompt,
//     });

//     console.log(prompt)
//     console.log(response.text)

//     return response.text;
//   } catch (error) {
//     console.error('Error Gemini:', error);
//     throw new Error('Error al consultar IA');
//   }
// }

/// TEXTO + MÚLTIPLES IMÁGENES CON FALLBACK
async function askAIWithImages({
  prompt,
  imagePaths = [],
  modelo = model,
}) {

  const parts = [
    {
      text: prompt,
      type: 'text',
    },
  ];

  for (
    const imagePath of imagePaths
  ) {

    const imageBuffer =
      fs.readFileSync(
        imagePath
      );

    parts.push({
      mime_type:
        detectMimeType(
          imagePath
        ),

      data:
        imageBuffer
          .toString('base64'),

      type:
        'image',
    });

  }

  return ejecutarConFallback({

    modeloPrincipal:
      modelo,

    operation:
      async (
        selectedModel,
        abortSignal
      ) => {

        /*
         * La API interactions no expone el
         * AbortSignal de la misma manera que
         * models.generateContent.
         *
         * El Promise.race seguirá activando
         * el fallback al vencer el tiempo.
         */
        void abortSignal;

        const response =
          await ai.interactions
            .create({

              model:
                selectedModel,

              input:
                parts,

              tools: [
                {
                  type:
                    'google_search',
                },
              ],

            });

        const usedGoogleSearch =
          response.steps?.some(
            step =>
              step.type ===
              'google_search_call'
          ) ?? false;

        const searches =
          response.steps
            ?.filter(
              step =>
                step.type ===
                'google_search_call'
            )
            ?.flatMap(
              step =>
                step.arguments
                  ?.queries ??
                []
            ) ??
          [];

        console.log(
          '\n===== GEMINI ====='
        );

        console.log(
          `Modelo utilizado: ${selectedModel}`
        );

        console.log(
          response.output_text
        );

        console.log(
          '\n===== TOOLING ====='
        );

        console.log(
          `Google Search usado: ${
            usedGoogleSearch
              ? 'SI'
              : 'NO'
          }`
        );

        if (usedGoogleSearch) {

          console.log(
            'Consultas ejecutadas:'
          );

          searches.forEach(
            (query, index) => {

              console.log(
                `  ${index + 1}. ${query}`
              );

            }
          );

        }

        return response.output_text;

      },

  });

}

/// ✅ TEXTO + MÚLTIPLES IMÁGENES
// async function askAIWithImages({ prompt, imagePaths = [], modelo}) {
//   try {
//     const parts = [
//       {
//         text: prompt,
//         type: "text",
//       },
//     ]
//     for (const imagePath of imagePaths) {
//       const imageBuffer = fs.readFileSync(imagePath);

      
//       parts.push(
//         {
//           mime_type: detectMimeType(imagePath),
//           data: imageBuffer.toString('base64'),
//           type: "image",
//         },
//     );
//     }


//     const response = await ai.interactions.create({
//       model: modelo,
//       input: parts, 
//       tools: [
//         {
//           type: "google_search"
//         }
//       ],
//     });

//     const usedGoogleSearch =
//       response.steps?.some(
//         step => step.type === "google_search_call"
//       ) || false;

//     const searches = response.steps
//       ?.filter(step => step.type === "google_search_call")
//       ?.flatMap(step => step.arguments?.queries || [])
//       || [];

//     console.log("\n===== GEMINI =====");
//     console.log(response.output_text);

//     console.log("\n===== TOOLING =====");
//     console.log(`Google Search usado: ${usedGoogleSearch ? "SI" : "NO"}`);

//     if (usedGoogleSearch) {
//       console.log("Consultas ejecutadas:");

//       searches.forEach((query, index) => {
//         console.log(`  ${index + 1}. ${query}`);
//       });
//     }

//     return response.output_text;
//   } catch (error) {
//     console.error('=== ERROR GEMINI ===');
//     console.dir(error, { depth: null });

//     throw error;
//   }
// }

async function askAIWithUrl({ prompt, imagePaths = [], url = ["https://lapipa.com/single-product/product?id=nevera-lg-no-frost-congelador-superior-217-litros-vt22bpy-gris"]}) {
  try {
    const parts = [
      {
        text: prompt,
        type: "text",
      },
      {
        text : `${url.map((r) => `- ${r}`).join('\n')}`,
        type: "text",
      }
    ]
    for (const imagePath of imagePaths) {
      const imageBuffer = fs.readFileSync(imagePath);

      
      parts.push(
        {
          mime_type: detectMimeType(imagePath),
          data: imageBuffer.toString('base64'),
          type: "image",
        },
    );
    }


    const response = await ai.interactions.create({
      model: model,
      input: parts,
      tools: [
        {type: "google_search"},
        {type: "url_context"},
      ],
    });

    const usedGoogleSearch =
      response.steps?.some(
        step => step.type === "google_search_call"
      ) || false;

    const searches = response.steps
      ?.filter(step => step.type === "google_search_call")
      ?.flatMap(step => step.arguments?.queries || [])
      || [];

    console.log("\n===== GEMINI =====");
    console.log(response.output_text);

    console.log("\n===== TOOLING =====");
    console.log(`Google Search usado: ${usedGoogleSearch ? "SI" : "NO"}`);

    if (usedGoogleSearch) {
      console.log("Consultas ejecutadas:");

      searches.forEach((query, index) => {
        console.log(`  ${index + 1}. ${query}`);
      });
    }

    return response.output_text;
  } catch (error) {
    console.error('=== ERROR GEMINI ===');
    console.dir(error, { depth: null });

    throw error;
  }
}

async function askAIStructured({
  role,
  taskDescription,
  contextData,
  outputSchemaExample,
  rules = [],
  imagePaths = [],
  documentPaths = [],
  modelo = model
}) {
  const prompt = `
${role}
Tu tarea es:
${taskDescription}

IMPORTANTE:
- Devuelve SOLO un JSON válido.
- No devuelvas markdown.
- No devuelvas texto extra.
- Si un valor no puede inferirse con confianza, devuelve null.

Reglas adicionales:
${rules.map((r) => `- ${r}`).join('\n')}

Contexto actual:
${JSON.stringify(contextData, null, 2)}

Devuelve exactamente un JSON con esta estructura:
${JSON.stringify(outputSchemaExample, null, 2)}
`;

  let finalImagePaths = [
    ...imagePaths
  ];

  console.log("IMAGE PATHS:");
  console.log(imagePaths);

  console.log("DOCUMENT PATHS:");
  console.log(documentPaths);

  for (
    const pdfPath of documentPaths
  ){

    try {

      const pdfImages =
        await pdfToImages(
          pdfPath
        );

      finalImagePaths.push(
        ...pdfImages
      );

    } catch(error){

      console.error(
        'Error convirtiendo PDF',
        pdfPath,
        error
      );

    }

  }

  const rawResponse =
    finalImagePaths.length > 0
      ? await askAIWithImages({
        prompt,
        imagePaths: finalImagePaths,
        modelo
      })
      : await askAI(prompt, modelo);
  
  //const rawResponse = await askAIWithUrl({ prompt, imagePaths });

  const cleanResponse = cleanAIResponse(rawResponse);

  try {
    return JSON.parse(cleanResponse);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido. Respuesta: ${rawResponse}`);
  }
}

async function pdfToImages(
  pdfPath
){

  const outputDir =
    path.join(
      __dirname,
      '../temp'
    );

  if (
    !fs.existsSync(outputDir)
  ){
    fs.mkdirSync(
      outputDir,
      { recursive:true }
    );
  }

  const convert = fromPath(
    pdfPath,
    {
      density: 200,

      saveFilename:
        path.basename(
          pdfPath,
          '.pdf'
        ),

      savePath:
        outputDir,

      format: "png",

      width: 1800,

      height: 2400,
    },
    {
      graphicsMagick: true,
    }
  );

  const pages =
  await convert.bulk(
    -1
  );

  console.log(
    "===== PDF CONVERTIDO ====="
  );

  console.dir(
    pages,
    { depth: null }
  );

  return pages.map(
    p => p.path
  );

}

module.exports = {
  askAI,
  askAIWithImages,
  askAIStructured,
};