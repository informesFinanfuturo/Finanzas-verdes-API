// controllers/mypimes.controller.js
const pool = require('../db');

// GET /api/mypimes
async function getMypimes(req, res) {
  try {

    const query = `
      SELECT 
        m.id,
        m.card,
        m.gender,
        m.education,
        m.company,
        m.nit,
        m.entity,
        m.timeInMarket,
        m.sector,
        m.municipality,
        m.phone,
        m.history,
        m.employees,
        m.address,
        m.income,
        m.expenses,
        m.ciiu,
        m."typeProject",

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM mypime m
      JOIN "user" u ON u.id = m."iduser"
      ORDER BY m.id;
    `;

    const result = await pool.query(query);

    return res.json(result.rows);

  } catch (err) {
    console.error('Error al obtener mypimes:', err);
    res.status(500).json({ error: 'Error al obtener mypimes' });
  }
}

// GET /api/mypime
async function getMypime(req, res) {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        m.id,
        m.card,
        m.gender,
        m.education,
        m.company,
        m.nit,
        m.entity,
        m.timeInMarket,
        m.sector,
        m.municipality,
        m.phone,
        m.history,
        m.employees,
        m.address,
        m.income,
        m.expenses,
        m.ciiu,
        m.typeProject,

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM mypime m
      JOIN "user" u ON u.id = m."iduser"
      WHERE m.id = $1
      ORDER BY m.id;
    `;

    const result = await pool.query(query, [id]);

    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "MiPyme no encontrada" });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Error al obtener mypime:', err);
    res.status(500).json({ error: 'Error al obtener mypime' });
  }
}

// PUT /api/mypime/:id
async function updateMypime(req, res) {
  try {
    const { id } = req.params;

    // Campos que SÍ se pueden editar (idUser NO se toca)
    const {
      card,
      gender,
      education,
      company,
      nit,
      entity,
      timeInMarket,
      sector,
      municipality,
      phone,
      history,
      employees,
      address,
      income,
      expenses,
      ciiu,
      typeProject,
    } = req.body;

    // 1. Validación básica
    if (!id) {
      return res.status(400).json({ error: "El id de la MiPyme es obligatorio" });
    }

    // (Opcional) Aquí podrías validar campos obligatorios
    // if (!company || !nit) { ... }

    // 2. Verificar que la MiPyme exista
    const existing = await pool.query(
      'SELECT id FROM mypime WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "MiPyme no encontrada" });
    }

    // 3. Actualizar MiPyme SIN tocar idUser
    const query = `
      UPDATE mypime
      SET
        card = $1,
        gender = $2,
        education = $3,
        company = $4,
        nit = $5,
        entity = $6,
        "timeinmarket" = $7,
        sector = $8,
        municipality = $9,
        phone = $10,
        history = $11,
        employees = $12,
        address = $13,
        income = $14,
        expenses = $15,
        ciiu = $16,
        "typeProject" = $17
      WHERE id = $18
      RETURNING
        id,
        card,
        gender,
        education,
        company,
        nit,
        entity,
        "timeinmarket",
        sector,
        municipality,
        phone,
        history,
        employees,
        address,
        income,
        expenses,
        ciiu,
        "typeProject",
        "iduser";
    `;

    const values = [
      card,
      gender,
      education,
      company,
      nit,
      entity,
      timeInMarket,
      sector,
      municipality,
      phone,
      history,
      employees,
      address,
      income,
      expenses,
      ciiu,
      typeProject,
      id,
    ];

    const result = await pool.query(query, values);
    const updatedMypime = result.rows[0];

    // 4. (Opcional) Traer también info del usuario como en tu getMypime
    // Si quieres devolver igual que en GET /api/mypime:
    const queryWithUser = `
      SELECT 
        m.id,
        m.card,
        m.gender,
        m.education,
        m.company,
        m.nit,
        m.entity,
        m."timeinmarket",
        m.sector,
        m.municipality,
        m.phone,
        m.history,
        m.employees,
        m.address,
        m.income,
        m.expenses,
        m.ciiu,
        m."typeProject",
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user
      FROM mypime m
      JOIN "user" u ON u.id = m."iduser"
      WHERE m.id = $1;
    `;

    const resultWithUser = await pool.query(queryWithUser, [id]);

    return res.status(200).json({
      message: "MiPyme actualizada correctamente",
      ...resultWithUser.rows[0],
    });

  } catch (err) {
    console.error("Error al actualizar mypime:", err);
    return res.status(500).json({ error: "Error interno al actualizar mypime" });
  }
}

// GET /api/mypime/user
async function getMypimeUser(req, res) {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        m.id,
        m.card,
        m.gender,
        m.education,
        m.company,
        m.nit,
        m.entity,
        m.timeInMarket,
        m.sector,
        m.municipality,
        m.phone,
        m.history,
        m.employees,
        m.address,
        m.income,
        m.expenses,
        m.ciiu,
        m."typeProject",

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM mypime m
      JOIN "user" u ON u.id = m."iduser"
      WHERE u.id = $1
      ORDER BY m.id;
    `;

    const result = await pool.query(query, [id]);

    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "MiPyme no encontrada" });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Error al obtener mypime:', err);
    res.status(500).json({ error: 'Error al obtener mypime' });
  }
}

// POST /api/mypimes
async function createMypime(req, res) {
  const {
    card,
    gender,
    education,
    company,
    nit,
    entity,
    timeInMarket,
    sector,
    municipality,
    phone,
    history,
    idUser,
    employees,
    address,
    income,
    expenses,
    ciiu,
    typeProject
  } = req.body;

  // Validación básica
  if (
    !card ||
    !gender ||
    !education ||
    !company ||
    !nit ||
    !entity ||
    !timeInMarket ||
    !sector ||
    !municipality ||
    !phone ||
    !history ||
    !idUser ||
    !employees ||
    !address ||
    !income ||
    !expenses ||
    !ciiu ||
    !typeProject
  ) {
    return res.status(400).json({
      error: 'Todos los campos son obligatorios'
    });
  }

  try {
    // 1. Insertar la Mipyme
    const insertResult = await pool.query(
      `INSERT INTO mypime (
        card, gender, education, company, nit, entity, 
        timeInMarket, sector, municipality, phone, history, "iduser", employees,
        address, income, expenses, ciiu, "typeProject"
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $13, $14, $15, $16, $17, $18)
      RETURNING id`,
      [
        card.trim(),
        gender.trim(),
        education.trim(),
        company.trim(),
        nit.trim(),
        entity.trim(),
        timeInMarket.trim(),
        sector.trim(),
        municipality.trim(),
        phone.trim(),
        history.trim(),
        idUser,
        employees,
        address.trim(),
        income,
        expenses,
        ciiu,
        typeProject.trim()
      ]
    );

    const newId = insertResult.rows[0].id;

    // 2. Consultar la Mipyme recién creada con el mismo formato de getMypime
    const query = `
      SELECT 
        m.id,
        m.card,
        m.gender,
        m.education,
        m.company,
        m.nit,
        m.entity,
        m.timeInMarket,
        m.sector,
        m.municipality,
        m.phone,
        m.history,
        m.employees,
        m.address,
        m.income,
        m.expenses,
        m.ciiu,
        m."typeProject",

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM mypime m
      JOIN "user" u ON u.id = m."iduser"
      WHERE m.id = $1
      ORDER BY m.id;
    `;

    const result = await pool.query(query, [newId]);

    return res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error('Error al crear mipyme:', err);
    return res.status(500).json({ error: 'Error al crear mipyme' });
  }
}

module.exports = {
  getMypimes,
  getMypime,
  createMypime,
  getMypimeUser,
  updateMypime
};