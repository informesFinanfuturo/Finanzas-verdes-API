const { chromium } = require('playwright');

const categorias = [
    {
    nombre: "Neveras",
    url: "https://lapipa.com/productos?categoria=ELECTRODOM%C3%89STICOS&subcategoria=TODO%20PARA%20REFRIGERAR%20Y%20CONGELAR&linea=NEVERAS"
    },
    {
    nombre: "Televisores",
    url: "https://lapipa.com/productos?categoria=TECNOLOGIA&subcategoria=TELEVISORES"
    },
    {
    nombre: "Ventiladores",
    url: "https://lapipa.com/productos?categoria=ELECTRODOM%C3%89STICOS&subcategoria=CLIMATIZACI%C3%93N&linea=VENTILADORES"
    },
];

async function extractWebsiteContent(
  url,
  categoria
) {

  const browser = await chromium.launch({
    headless: true,
  });

  try {

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    await page.waitForSelector(
      ".product-details-area"
    );

    // =========================
    // Agotado
    // =========================

    const agotado = await page
      .$eval(
        ".alert-warning",
        el =>
          el.innerText
            .toLowerCase()
            .includes("agotado")
      )
      .catch(() => false);

    // =========================
    // Nombre
    // =========================

    const nombre = await page
      .$eval(
        ".product-details-area h2",
        el => el.innerText.trim()
      )
      .catch(() => null);

    // =========================
    // Precio actual
    // =========================

    const precioTexto = await page
      .$eval(
        ".current-price",
        el => el.innerText.trim()
      )
      .catch(() => null);

    // =========================
    // Precio anterior
    // =========================

    const precioAnteriorTexto =
      await page
        .$eval(
          ".old-price",
          el => el.innerText.trim()
        )
        .catch(() => null);

    // =========================
    // Descripción
    // =========================

    const descripcion = await page
      .$eval(
        ".product-description-wrapper",
        el => el.innerText.trim()
      )
      .catch(() => "");

    // =========================
    // Especificaciones
    // =========================

    const textosMso = await page
      .$$eval(
        ".product-description-wrapper .MsoNormal",
        elements =>
          elements.map(el =>
            el.innerText.trim()
          )
      )
      .catch(() => []);

    const especificaciones =
      buildSpecifications(
        textosMso
      );

    // =========================
    // Resultado
    // =========================

    return {

      nombre,

      categoria,

      url,

      disponible: !agotado,

      precio: parsePrice(
        precioTexto
      ),

      precio_anterior:
        parsePrice(
          precioAnteriorTexto
        ),

      descripcion,

      especificaciones,

    };

  } finally {

    await browser.close();

  }

}

async function getProductLinks(categoryUrl) {

  const browser = await chromium.launch({
    headless: true,
  });

  try {

    const page = await browser.newPage();

    await page.goto(categoryUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    const productLinks = await page.$$eval(

      'article.list-product a.thumbnail',

      links =>
        links.map(link =>
          link.href.split('#')[0]
        )

    );

    return [...new Set(productLinks)];

  } finally {

    await browser.close();

  }

}

async function extractCategory(
  categoryUrl,
  categoria
) {
  const productLinks =
    await getProductLinks(categoryUrl);

  console.log(
    `Productos encontrados: ${productLinks.length}`
  );

  const results = [];

  for (const url of productLinks) {

    try {

      console.log(
        `Procesando: ${url}`
      );

      const product =
        await extractWebsiteContent(
          url,
          categoria
        );

      results.push(product);

    } catch (error) {

      console.error(
        `Error en ${url}`,
        error.message
      );

    }

  }

  return results;
}

async function extractCatalogLaPipa() {

  const allProducts = [];

  for (const categoria of categorias) {

    console.log(
      `\n===== ${categoria.nombre} =====`
    );

    const products =
      await extractCategory(
        categoria.url,
        categoria.nombre
      );

    console.log(
      `Encontrados: ${products.length}`
    );

    allProducts.push(
      ...products
    );

  }

  return allProducts;
}

function removeDuplicates(products) {

  const map = new Map();

  products.forEach(product => {

    map.set(
      product.url,
      product
    );

  });

  return [...map.values()];
}

function buildSpecifications(items) {

  const specs = {};

  let readingSpecs = false;
  let specIndex = 1;

  for (const item of items) {

    const text = item.trim();

    if (!text) continue;

    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (
      normalized === "caracteristicas" ||
      normalized === "especificaciones"
    ) {

      readingSpecs = true;
      continue;

    }

    if (!readingSpecs) {
      continue;
    }

    if (text.includes(":")) {

      const [key, ...valueParts] =
        text.split(":");

      specs[key.trim()] =
        valueParts.join(":").trim();

    } else {

      specs[
        `especificacion_${specIndex}`
      ] = text;

      specIndex++;

    }

  }

  return specs;

}

function parsePrice(text) {

  if (!text) {
    return null;
  }

  const match = text.match(
    /\d[\d.]*/
  );

  if (!match) {
    return null;
  }

  return Number(
    match[0]
      .replace(/\./g, "")
  );

}

module.exports = {
  extractCatalogLaPipa,
  removeDuplicates,
};