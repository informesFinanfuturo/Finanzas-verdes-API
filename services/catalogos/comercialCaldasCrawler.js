const { chromium } = require('playwright');
const axios = require('axios');

const categorias = [
  {
    nombre: 'Grifos',
    url: 'https://comercialcaldas.com/categoria-producto/cocinas/griferia-lavaplatos/',
  },
  {
    nombre: 'Grifos',
    url: 'https://comercialcaldas.com/categoria-producto/banos/griferia-lavamanos/',
  },
  {
    nombre: 'Grifos',
    url: 'https://comercialcaldas.com/categoria-producto/banos/griferia-lavamanos/page/2/',
  },
  {
    nombre: 'Grifos',
    url: 'https://comercialcaldas.com/categoria-producto/banos/griferia-ducha/',
  },
  {
    nombre: 'Grifos',
    url: 'https://comercialcaldas.com/categoria-producto/banos/griferia-ducha/page/2/',
  },
  {
    nombre: 'Sanitarios',
    url: 'https://comercialcaldas.com/categoria-producto/banos/sanitarios/',
  },
  {
    nombre: 'Sanitarios',
    url: 'https://comercialcaldas.com/categoria-producto/banos/sanitarios/page/2/',
  },
  {
    nombre: 'Sanitarios',
    url: 'https://comercialcaldas.com/categoria-producto/banos/orinal/',
  },
];

function delay(milliseconds) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

async function gotoWithRetry(
  page,
  url,
  {
    retries = 3,
    timeout = 60000,
  } = {}
) {

  if (
    typeof url !== 'string' ||
    !url.trim().startsWith('http')
  ) {
    throw new TypeError(
      `URL inválida recibida por el crawler: ${String(url)}`
    );
  }

  let lastError;

  for (
    let attempt = 1;
    attempt <= retries;
    attempt++
  ) {
    try {
      console.log(
        `Navegando (${attempt}/${retries}): ${url}`
      );

      const response =
        await page.goto(
          url,
          {
            waitUntil:
              'domcontentloaded',
            timeout,
          }
        );

      if (
        response &&
        response.status() >= 400
      ) {
        throw new Error(
          `La página respondió HTTP ${response.status()}`
        );
      }

      /*
       * Pequeña espera para permitir que
       * WooCommerce termine de pintar el DOM.
       */
      await page.waitForTimeout(1000);

      return response;
    } catch (error) {
      lastError = error;

      console.warn(
        `Intento ${attempt} fallido para ${url}:`,
        error.message
      );

      if (attempt < retries) {
        const waitTime =
          attempt * 5000;

        console.log(
          `Esperando ${waitTime / 1000} segundos antes del siguiente intento`
        );

        await delay(waitTime);
      }
    }
  }

  throw lastError;
}

async function getProductLinksComercialCaldas(
  context,
  categoryUrl
) {
  const page =
    await context.newPage();

  try {
    await gotoWithRetry(
      page,
      categoryUrl
    );

    const links =
      await page.$$eval(
        'a.ast-loop-product__link',
        items =>
          items
            .map(item => item.href)
            .filter(Boolean)
      );

    return [
      ...new Set(links),
    ];
  } finally {
    await page.close();
  }
}

async function findProductPdfUrl(
  page
) {
  return page.evaluate(() => {
    const candidates = [];

    document
      .querySelectorAll(
        'a[href*=".pdf"], iframe[src*=".pdf"], embed[src*=".pdf"]'
      )
      .forEach(element => {
        const value =
          element.href ||
          element.src;

        if (value) {
          candidates.push(value);
        }
      });

    if (candidates.length === 0) {
      return null;
    }

    /*
     * Damos prioridad a enlaces que
     * parezcan fichas técnicas.
     */
    const technicalSheet =
      candidates.find(url => {
        const normalized =
          url.toLowerCase();

        return (
          normalized.includes('ficha') ||
          normalized.includes('tecnica') ||
          normalized.includes('technical')
        );
      });

    return (
      technicalSheet ||
      candidates[0]
    );
  });
}

function buildPossiblePdfUrl(
  nombre
) {
  if (!nombre) {
    return null;
  }

  let nombrePdf = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/#/g, '-')
    .replace(/\//g, '.')
    .replace(/′/g, '_')
    .replace(/\*/g, 'X')
    .replace(/\((.*?)\)/g, '$1')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');

  nombrePdf =
    encodeURIComponent(nombrePdf)
      .replace(/%20/g, '-')
      .replace(/%C3%97/g, 'x');

  return (
    'https://comercialcaldas.com/' +
    'wp-content/uploads/2024/02/' +
    `${nombrePdf}_fichatecnica.pdf`
  );
}

async function extractWebsiteContentComercialCaldas(
  context,
  url,
  categoria
) {
  const page =
    await context.newPage();

  try {
    await gotoWithRetry(
      page,
      url
    );

    const nombre =
      await page
        .$eval(
          '.product_title',
          element =>
            element.textContent.trim()
        )
        .catch(() => null);

    const precioTexto =
      await page
        .$eval(
          '.price',
          element =>
            element.textContent.trim()
        )
        .catch(() => null);

    const disponible =
      await page.evaluate(() => {
        if (
          document.querySelector(
            '.stock.out-of-stock'
          )
        ) {
          return false;
        }

        if (
          document.querySelector(
            '.single_add_to_cart_button'
          )
        ) {
          return true;
        }

        if (
          document.querySelector(
            'form.cart'
          )
        ) {
          return true;
        }

        return false;
      });

    /*
     * Primero buscamos un enlace real
     * dentro de la página.
     */
    let pdfUrl =
      await findProductPdfUrl(
        page
      );

    /*
     * Si no aparece en el HTML, usamos
     * la URL calculada como alternativa.
     */
    if (!pdfUrl) {
      pdfUrl =
        buildPossiblePdfUrl(
          nombre
        );
    }

    const pdfContenido =
      pdfUrl
        ? await downloadPdfAsBase64(
            pdfUrl
          )
        : null;

    return {
      nombre,
      categoria,
      url,
      disponible,
      precio:
        parsePrice(
          precioTexto
        ),
      pdfUrl:
        pdfContenido
          ? pdfUrl
          : null,
      pdfContenido,
    };
  } finally {
    await page.close();
  }
}

async function extractCategoryComercialCaldas(
  context,
  categoryUrl,
  categoryName
) {
  if (
    typeof categoryUrl !== 'string' ||
    !categoryUrl.startsWith('http')
  ) {
    throw new TypeError(
      `La categoría "${categoryName}" no tiene una URL válida: ${String(categoryUrl)}`
    );
  }

  const productLinks =
    await getProductLinksComercialCaldas(
      context,
      categoryUrl
    );

  console.log(
    `Productos encontrados en ${categoryName}: ${productLinks.length}`
  );

  const results = [];

  for (
    let index = 0;
    index < productLinks.length;
    index++
  ) {
    const productUrl =
      productLinks[index];

    try {
      console.log(
        `Procesando ${index + 1}/${productLinks.length}: ${productUrl}`
      );

      const product =
        await extractWebsiteContentComercialCaldas(
          context,
          productUrl,
          categoryName
        );

      if (product?.nombre) {
        results.push(product);
      }
    } catch (error) {
      console.error(
        `No fue posible procesar ${productUrl}:`,
        error.message
      );
    }

    await delay(1500);
  }

  return results;
}

async function extractCatalogComercialCaldas() {
  const browser =
    await chromium.launch({
      headless: true,
    });

  const context =
    await browser.newContext({
      viewport: {
        width: 1366,
        height: 768,
      },
      userAgent:
        'Mozilla/5.0 ' +
        '(Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) ' +
        'Chrome/128.0.0.0 ' +
        'Safari/537.36',
      locale: 'es-CO',
    });

  const allProducts = [];

  try {
    for (const categoria of categorias) {
      console.log(
        `\n===== ${categoria.nombre} =====`
      );

      /*
       * Este log permite comprobar
       * inmediatamente qué valor está llegando.
       */
      console.log(
        'URL categoría:',
        categoria.url
      );

      if (
        typeof categoria.url !== 'string' ||
        !categoria.url.startsWith('http')
      ) {
        console.error(
          `Categoría omitida porque su URL es inválida:`,
          categoria
        );

        continue;
      }

      try {
        const products =
          await extractCategoryComercialCaldas(
            context,
            categoria.url,
            categoria.nombre
          );

        console.log(
          `Encontrados en ${categoria.nombre}: ${products.length}`
        );

        allProducts.push(
          ...products
        );
      } catch (error) {
        console.error(
          `No fue posible procesar la categoría ${categoria.nombre}:`,
          error.message
        );
      }

      await delay(3000);
    }

    return allProducts;
  } finally {
    await context.close();
    await browser.close();
  }
}

function removeDuplicates(products) {

  const map = new Map();

  products.forEach(
    product => {

      map.set(
        product.url,
        product
      );

    }
  );

  return [
    ...map.values()
  ];

}

function parsePrice(text) {

  if (!text) {
    return null;
  }

  const match =
    text.match(
      /\d[\d.]*/
    );

  if (!match) {
    return null;
  }

  return Number(
    match[0]
      .replace(/\./g, '')
  );

}

async function downloadPdfAsBase64(
  pdfUrl
) {
  try {
    const response =
      await axios.get(
        pdfUrl,
        {
          responseType:
            'arraybuffer',

          timeout: 30000,

          validateStatus:
            status =>
              status >= 200 &&
              status < 300,

          headers: {
            'User-Agent':
              'Mozilla/5.0 ' +
              '(Windows NT 10.0; Win64; x64) ' +
              'AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) ' +
              'Chrome/128.0.0.0 ' +
              'Safari/537.36',
          },
        }
      );

    const contentType =
      response.headers[
        'content-type'
      ] || '';

    if (
      !contentType.includes(
        'application/pdf'
      )
    ) {
      console.warn(
        'La URL no devolvió un PDF:',
        pdfUrl,
        contentType
      );

      return null;
    }

    return Buffer
      .from(response.data)
      .toString('base64');
  } catch (error) {
    const status =
      error.response?.status;

    if (status === 404) {
      console.log(
        'Producto sin ficha PDF:',
        pdfUrl
      );
    } else {
      console.error(
        'No fue posible descargar el PDF:',
        pdfUrl,
        status || error.message
      );
    }

    return null;
  }
}

function normalizarResultadosPowerAutomate(
  responseData
) {
  console.log(
    'Respuesta completa de Power Automate:',
    JSON.stringify(
      responseData,
      null,
      2
    )
  );

  let resultados =
    responseData?.Resultados ??
    responseData?.resultados ??
    responseData?.body?.Resultados ??
    responseData?.body?.resultados ??
    responseData;

  if (typeof resultados === 'string') {
    try {
      resultados =
        JSON.parse(resultados);
    } catch (error) {
      throw new Error(
        `Power Automate devolvió Resultados como texto inválido: ${error.message}`
      );
    }
  }

  if (!Array.isArray(resultados)) {
    throw new Error(
      'Power Automate no devolvió un arreglo de resultados'
    );
  }

  return resultados;
}

function normalizarResultadosPowerAutomate(
  responseData
) {
  console.log(
    'Respuesta completa de Power Automate:',
    JSON.stringify(
      responseData,
      null,
      2
    )
  );

  let resultados =
    responseData?.Resultados ??
    responseData?.resultados ??
    responseData?.body?.Resultados ??
    responseData?.body?.resultados ??
    responseData;

  if (typeof resultados === 'string') {
    try {
      resultados =
        JSON.parse(resultados);
    } catch (error) {
      throw new Error(
        `Power Automate devolvió un JSON inválido: ${error.message}`
      );
    }
  }

  if (!Array.isArray(resultados)) {
    throw new Error(
      `La respuesta de Power Automate no contiene un arreglo de resultados. Claves recibidas: ${
        responseData &&
        typeof responseData === 'object'
          ? Object.keys(responseData).join(', ')
          : 'ninguna'
      }`
    );
  }

  return resultados;
}

async function enviarFichasAPowerAutomate(
  productos
) {
  const powerAutomateUrl =
    process.env.POWER_AUTOMATE_FICHAS_URL;

  if (!powerAutomateUrl) {
    throw new Error(
      'POWER_AUTOMATE_FICHAS_URL no está configurada'
    );
  }

  const fichas = productos
    .filter(
      producto =>
        producto.pdfContenido
    )
    .map(
      producto => ({
        NombreArchivo:
          `${producto.nombre}.pdf`,

        Contenido:
          producto.pdfContenido,
      })
    );

  if (fichas.length === 0) {
    return [];
  }

  const payload = {
    Fichas: fichas,
  };

  const payloadBytes =
    Buffer.byteLength(
      JSON.stringify(payload),
      'utf8'
    );

  console.log(
    `Enviando lote con ${fichas.length} fichas`
  );

  console.log(
    'Peso del lote:',
    `${(
      payloadBytes /
      1024 /
      1024
    ).toFixed(2)} MB`
  );

  try {
    const response =
      await axios.post(
        powerAutomateUrl,
        payload,
        {
          headers: {
            'Content-Type':
              'application/json',
          },

          timeout: 120000,

          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );

    console.log(
      'Estado Power Automate:',
      response.status
    );

    return normalizarResultadosPowerAutomate(
      response.data
    );
  } catch (error) {
    if (
      error.code === 'ECONNABORTED'
    ) {
      throw new Error(
        'Power Automate superó los 120 segundos procesando el lote'
      );
    }

    if (error.response) {
      throw new Error(
        `Power Automate respondió ${error.response.status}: ${
          typeof error.response.data === 'string'
            ? error.response.data
            : JSON.stringify(
                error.response.data
              )
        }`
      );
    }

    throw error;
  }
}

async function procesarFichasPorLotesAPowerAutomate(
  productos,
  batchSize = 2
) {
  if (!Array.isArray(productos)) {
    throw new TypeError(
      'productos debe ser un arreglo'
    );
  }

  if (
    !Number.isInteger(batchSize) ||
    batchSize <= 0
  ) {
    throw new TypeError(
      'batchSize debe ser un entero mayor que cero'
    );
  }

  const resultadosPorUrl =
    new Map();

  const totalLotes =
    Math.ceil(
      productos.length /
      batchSize
    );

  console.log(
    `Power Automate procesará ${productos.length} productos en ${totalLotes} lotes`
  );

  for (
    let start = 0;
    start < productos.length;
    start += batchSize
  ) {
    const lote =
      productos.slice(
        start,
        start + batchSize
      );

    const numeroLote =
      Math.floor(
        start / batchSize
      ) + 1;

    console.log(
      `\n===== Lote ${numeroLote}/${totalLotes} =====`
    );

    console.log(
      'Productos del lote:',
      lote.map(
        producto =>
          producto.nombre
      )
    );

    const resultadosLote =
      await enviarFichasAPowerAutomate(
        lote
      );

    console.log(
      `Resultados del lote ${numeroLote}:`,
      resultadosLote.length
    );

    /*
     * Sin una referencia devuelta por
     * Power Automate, la única forma segura
     * de relacionar los datos es que cada lote
     * devuelva exactamente la misma cantidad.
     */
    if (
      resultadosLote.length !==
      lote.length
    ) {
      throw new Error(
        `El lote ${numeroLote} envió ${lote.length} fichas, ` +
        `pero Power Automate devolvió ${resultadosLote.length} resultados`
      );
    }

    lote.forEach(
      (producto, index) => {
        resultadosPorUrl.set(
          producto.url,
          resultadosLote[index]
        );
      }
    );

    /*
     * Pausa corta para no iniciar inmediatamente
     * otra ejecución pesada del flujo.
     */
    if (
      numeroLote < totalLotes
    ) {
      await delay(2000);
    }
  }

  console.log(
    'Total de productos relacionados con IA:',
    resultadosPorUrl.size
  );

  return resultadosPorUrl;
}

module.exports = {
  extractCatalogComercialCaldas,
  removeDuplicates,
  procesarFichasPorLotesAPowerAutomate,
};