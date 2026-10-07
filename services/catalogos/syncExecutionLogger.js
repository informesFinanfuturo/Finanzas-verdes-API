const {
  AsyncLocalStorage,
} = require('async_hooks');

const util = require('util');

const pool = require('../../db');


/*
 * =========================================================
 * CONTEXTO ASÍNCRONO
 * =========================================================
 *
 * Permite identificar qué mensajes de consola pertenecen
 * a una sincronización concreta sin capturar los logs del
 * resto del backend.
 */
const syncStorage =
  new AsyncLocalStorage();


/*
 * Conservamos las funciones originales para evitar
 * recursión cuando escribamos los logs.
 */
const originalConsole = {
  log:
    console.log.bind(console),

  warn:
    console.warn.bind(console),

  error:
    console.error.bind(console),
};


/*
 * =========================================================
 * SEGURIDAD
 * =========================================================
 *
 * No queremos terminar almacenando tokens, contraseñas,
 * firmas de URLs o secretos por accidente.
 */

function isSensitiveKey(
  key
) {
  return (
    /password/i.test(key) ||
    /token/i.test(key) ||
    /secret/i.test(key) ||
    /authorization/i.test(key) ||
    /cookie/i.test(key) ||
    /api[_-]?key/i.test(key) ||
    /signature/i.test(key) ||
    /(^|_)sig($|_)/i.test(key)
  );
}


function redactSecretsInString(
  value
) {
  if (
    typeof value !==
    'string'
  ) {
    return value;
  }

  let result =
    value;

  /*
   * Bearer tokens.
   */
  result =
    result.replace(
      /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
      'Bearer [REDACTED]',
    );

  /*
   * Firmas y tokens presentes en query strings.
   */
  result =
    result.replace(
      /([?&](?:sig|signature|token|key|code)=)[^&\s]+/gi,
      '$1[REDACTED]',
    );

  /*
   * Evitar registros absurdamente grandes.
   */
  const maxLength =
    12000;

  if (
    result.length >
    maxLength
  ) {
    return (
      result.substring(
        0,
        maxLength,
      ) +
      '\n...[contenido truncado]'
    );
  }

  return result;
}


function sanitizeValue(
  value,
  depth = 0,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    depth > 6
  ) {
    return '[MAX_DEPTH]';
  }

  if (
    typeof value ===
    'string'
  ) {
    return redactSecretsInString(
      value,
    );
  }

  if (
    typeof value ===
    'number' ||
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return (
      `[Buffer ${value.length} bytes]`
    );
  }

  if (
    value instanceof Error
  ) {
    return {
      name:
        value.name,

      message:
        redactSecretsInString(
          value.message,
        ),

      code:
        value.code ??
        null,

      stack:
        redactSecretsInString(
          value.stack ??
          '',
        ),
    };
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        100,
      )
      .map(
        item =>
          sanitizeValue(
            item,
            depth + 1,
            seen,
          ),
      );
  }

  if (
    typeof value ===
    'object'
  ) {
    if (
      seen.has(value)
    ) {
      return '[CIRCULAR]';
    }

    seen.add(value);

    const output = {};

    for (
      const [
        key,
        currentValue,
      ]
      of Object.entries(
        value,
      )
    ) {
      if (
        isSensitiveKey(key)
      ) {
        output[key] =
          '[REDACTED]';

        continue;
      }

      output[key] =
        sanitizeValue(
          currentValue,
          depth + 1,
          seen,
        );
    }

    return output;
  }

  return redactSecretsInString(
    String(value),
  );
}


function serializeArguments(
  args
) {
  return args.map(
    item =>
      sanitizeValue(item),
  );
}


function buildMessage(
  args
) {
  const message =
    args
      .map(
        item => {
          if (
            typeof item ===
            'string'
          ) {
            return redactSecretsInString(
              item,
            );
          }

          if (
            item instanceof Error
          ) {
            return redactSecretsInString(
              `${item.name}: ${item.message}`,
            );
          }

          return redactSecretsInString(
            util.inspect(
              sanitizeValue(
                item,
              ),
              {
                depth: 4,
                maxArrayLength: 50,
                breakLength: 160,
              },
            ),
          );
        },
      )
      .join(' ');

  return redactSecretsInString(
    message,
  );
}


/*
 * =========================================================
 * PERSISTENCIA
 * =========================================================
 */

async function persistLog({
  context,
  level,
  args,
}) {
  if (
    !context?.idSincronizacion
  ) {
    return;
  }

  const message =
    buildMessage(args);

  const detail = {
    arguments:
      serializeArguments(
        args,
      ),
  };

  await pool.query(
    `
    INSERT INTO
      catalogo_sincronizacion_log (
        id_sincronizacion,
        id_proveedor,
        proveedor,
        nivel,
        etapa,
        mensaje,
        detalle,
        created_at
      )

    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::jsonb,
      NOW()
    )
    `,
    [
      context.idSincronizacion,

      context.idProveedor ??
        null,

      context.proveedor ??
        null,

      level,

      context.etapa ??
        'GENERAL',

      message,

      JSON.stringify(
        detail,
      ),
    ],
  );
}


/*
 * =========================================================
 * CAPTURA DE CONSOLA
 * =========================================================
 */

function queuePersistence(
  level,
  args
) {
  const context =
    syncStorage.getStore();

  if (!context) {
    return;
  }

  if (
    level ===
    'ERROR'
  ) {
    context.state.errors++;
  }

  if (
    level ===
    'WARN'
  ) {
    context.state.warnings++;
  }

  const promise =
    persistLog({
      context,
      level,
      args,
    });

  context.state.pending.add(
    promise,
  );

  promise
    .catch(
      error => {
        /*
         * Un fallo escribiendo logs jamás debe
         * detener el crawler.
         */
        originalConsole.error(
          '[SYNC LOGGER] No fue posible guardar el log:',
          error.message,
        );
      },
    )
    .finally(
      () => {
        context.state.pending.delete(
          promise,
        );
      },
    );
}


function installConsoleCapture() {
  if (
    global
      .__FINANZAS_VERDES_SYNC_CONSOLE_CAPTURE__
  ) {
    return;
  }

  global
    .__FINANZAS_VERDES_SYNC_CONSOLE_CAPTURE__ =
    true;

  console.log =
    (...args) => {
      originalConsole.log(
        ...args,
      );

      queuePersistence(
        'INFO',
        args,
      );
    };

  console.warn =
    (...args) => {
      originalConsole.warn(
        ...args,
      );

      queuePersistence(
        'WARN',
        args,
      );
    };

  console.error =
    (...args) => {
      originalConsole.error(
        ...args,
      );

      queuePersistence(
        'ERROR',
        args,
      );
    };
}


/*
 * =========================================================
 * EJECUCIÓN CONTEXTUAL
 * =========================================================
 */

async function runWithSyncLogContext({
  idSincronizacion,
  idProveedor = null,
  proveedor = null,
  etapa = 'GENERAL',
}, callback) {

  const state = {
    pending:
      new Set(),

    errors:
      0,

    warnings:
      0,
  };

  const context = {
    idSincronizacion,
    idProveedor,
    proveedor,
    etapa,
    state,
  };

  return syncStorage.run(
    context,
    async () => {
      try {
        return await callback();
      } finally {
        /*
         * Esperamos que terminen los INSERT
         * pendientes antes de abandonar el
         * contexto de la ejecución.
         */
        const pending =
          Array.from(
            state.pending,
          );

        if (
          pending.length > 0
        ) {
          await Promise.allSettled(
            pending,
          );
        }
      }
    },
  );
}


async function withSyncStage(
  etapa,
  callback
) {
  const current =
    syncStorage.getStore();

  if (!current) {
    return callback();
  }

  const child = {
    ...current,

    /*
     * Compartimos state para que los contadores
     * sigan perteneciendo al proveedor.
     */
    state:
      current.state,

    etapa:
      etapa ||
      current.etapa,
  };

  return syncStorage.run(
    child,
    callback,
  );
}


function getSyncLogStats() {
  const current =
    syncStorage.getStore();

  if (!current) {
    return {
      errors: 0,
      warnings: 0,
    };
  }

  return {
    errors:
      current.state.errors,

    warnings:
      current.state.warnings,
  };
}


/*
 * Se instala una sola vez al cargar el módulo.
 */
installConsoleCapture();


module.exports = {
  runWithSyncLogContext,
  withSyncStage,
  getSyncLogStats,
};