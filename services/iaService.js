const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const model = 'gemini-3.1-flash-lite';

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

/// ✅ SOLO TEXTO
async function askAI(prompt) {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    console.log(prompt)
    console.log(response.text)

    return response.text;
  } catch (error) {
    console.error('Error Gemini:', error);
    throw new Error('Error al consultar IA');
  }
}

/// ✅ TEXTO + MÚLTIPLES IMÁGENES
async function askAIWithImages({ prompt, imagePaths = [] }) {
  try {
    const parts = [{ text: prompt }];

    for (const imagePath of imagePaths) {
      const imageBuffer = fs.readFileSync(imagePath);

      parts.push({
        inlineData: {
          mimeType: detectMimeType(imagePath),
          data: imageBuffer.toString('base64'),
        },
      });
    }

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
    });

    console.log("🧠 IA (texto):\n", response.text);

    return response.text;
  } catch (error) {
    console.error('Error Gemini imágenes:', error);
    throw new Error('Error al analizar imágenes');
  }
}

async function askAIStructured({
  role,
  taskDescription,
  contextData,
  outputSchemaExample,
  rules = [],
  imagePaths = [],
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

  const rawResponse =
    imagePaths.length > 0
      ? await askAIWithImages({ prompt, imagePaths })
      : await askAI(prompt);

  const cleanResponse = cleanAIResponse(rawResponse);

  try {
    return JSON.parse(cleanResponse);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido. Respuesta: ${rawResponse}`);
  }
}

module.exports = {
  askAI,
  askAIWithImages,
  askAIStructured,
};