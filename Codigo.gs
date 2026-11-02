/**
 * Panel Sensorial por Sesiones — servidor en Google Apps Script
 *
 * Hojas que usa (se crean solas):
 *   Config      -> ClaveAdmin y nombre del estudio
 *   Atributos   -> un atributo por fila (columna "Nombre")
 *   Sesiones    -> Sesion | Grupo | Rep | NMuestras | Vinos
 *   Diseno      -> Sesion | Grupo | Rep | Valuador | Orden | Muestra | NombreProducto | CodigoProducto
 *   Respuestas  -> una fila por muestra evaluada (se actualiza si el panelista corrige)
 *
 * Todas las llamadas son POST con un JSON { accion: "...", ... }.
 */

const HOJA = {
  CONFIG: 'Config',
  ATR: 'Atributos',
  SES: 'Sesiones',
  DIS: 'Diseno',
  RES: 'Respuestas',
};

// ---------------------------------------------------------------- entrada
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  try {
    const fn = ACCIONES[req.accion];
    if (!fn) return json_({ ok: false, error: 'Acción desconocida: ' + req.accion });
    return json_(fn(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, mensaje: 'Panel Sensorial (sesiones) activo' });
}

const ACCIONES = {
  // ---- públicas (panelistas)
  config: function () {
    const sesiones = leer_(HOJA.SES);
    const diseno = leer_(HOJA.DIS);
    const panelistas = unicos_(diseno.map(r => String(r.Valuador)));
    return {
      ok: true,
      estudio: valorConfig_('Estudio') || 'Análisis Sensorial',
      atributos: leerAtributos_(),
      sesiones: sesiones.map(s => ({
        Sesion: String(s.Sesion), Grupo: String(s.Grupo), Rep: Number(s.Rep), NMuestras: Number(s.NMuestras),
      })),
      panelistas: panelistas,
    };
  },

  panelista: function (req) {
    const v = String(req.valuador || '').trim();
    const diseno = leer_(HOJA.DIS)
      .filter(r => String(r.Valuador) === v)
      .map(r => ({
        Sesion: String(r.Sesion), Grupo: String(r.Grupo), Rep: Number(r.Rep), Valuador: String(r.Valuador),
        Orden: Number(r.Orden), Muestra: String(r.Muestra), NombreProducto: String(r.NombreProducto),
        CodigoProducto: String(r.CodigoProducto),
      }));
    return { ok: true, diseno: diseno, progreso: progreso_(v) };
  },

  guardar: function (req) {
    const filas = Array.isArray(req.filas) ? req.filas : (req.fila ? [req.fila] : []);
    if (!filas.length) return { ok: true, guardadas: 0 };
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const hoja = hoja_(HOJA.RES);
      filas.forEach(f => upsert_(hoja, f));
    } finally {
      lock.releaseLock();
    }
    return { ok: true, guardadas: filas.length };
  },

  // ---- administrador (requieren clave)
  adminLogin: function (req) {
    verificarAdmin_(req);
    return { ok: true, estudio: valorConfig_('Estudio') || '' };
  },

  adminGuardarDiseno: function (req) {
    verificarAdmin_(req);
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const res = ss.getSheetByName(HOJA.RES);
      if (res && res.getLastRow() > 1) {
        if (!req.forzar) {
          return { ok: false, hayRespuestas: true, error: 'Ya hay respuestas cargadas para el diseño actual.' };
        }
        // No se borra nada: se renombra la hoja como respaldo
        res.setName('Respuestas_respaldo_' + Utilities.formatDate(new Date(), 'GMT-3', 'yyyyMMdd_HHmm'));
      }
      if (req.estudio) setConfig_('Estudio', String(req.estudio));
      escribir_(HOJA.ATR, ['Nombre'], (req.atributos || []).map(a => [a]));
      escribir_(HOJA.SES, ['Sesion', 'Grupo', 'Rep', 'NMuestras', 'Vinos'],
        (req.sesiones || []).map(s => [s.Sesion, s.Grupo, s.Rep, s.NMuestras, s.Vinos]));
      escribir_(HOJA.DIS, ['Sesion', 'Grupo', 'Rep', 'Valuador', 'Orden', 'Muestra', 'NombreProducto', 'CodigoProducto'],
        (req.diseno || []).map(d => [d.Sesion, d.Grupo, d.Rep, d.Valuador, d.Orden, d.Muestra, d.NombreProducto, d.CodigoProducto]));
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  },

  adminEstado: function (req) {
    verificarAdmin_(req);
    const diseno = leer_(HOJA.DIS).map(r => ({
      Sesion: String(r.Sesion), Grupo: String(r.Grupo), Rep: Number(r.Rep), Valuador: String(r.Valuador),
      Orden: Number(r.Orden), Muestra: String(r.Muestra), NombreProducto: String(r.NombreProducto),
      CodigoProducto: String(r.CodigoProducto),
    }));
    const respondidas = {};
    leer_(HOJA.RES).forEach(r => {
      const k = String(r.Valuador) + '|' + String(r.Sesion);
      respondidas[k] = respondidas[k] || {};
      respondidas[k][Number(r.Orden)] = true;
    });
    const conteo = {};
    Object.keys(respondidas).forEach(k => { conteo[k] = Object.keys(respondidas[k]).length; });
    return {
      ok: true,
      estudio: valorConfig_('Estudio') || '',
      atributos: leerAtributos_(),
      sesiones: leer_(HOJA.SES).map(s => ({
        Sesion: String(s.Sesion), Grupo: String(s.Grupo), Rep: Number(s.Rep), NMuestras: Number(s.NMuestras), Vinos: String(s.Vinos),
      })),
      diseno: diseno,
      conteo: conteo,
    };
  },
};

// ---------------------------------------------------------------- helpers
function progreso_(valuador) {
  const out = {};
  leer_(HOJA.RES).forEach(r => {
    if (String(r.Valuador) !== valuador) return;
    const s = String(r.Sesion);
    out[s] = out[s] || [];
    const o = Number(r.Orden);
    if (out[s].indexOf(o) === -1) out[s].push(o);
  });
  return out; // { S1: [1,2,3], ... } órdenes respondidas por sesión
}

function verificarAdmin_(req) {
  const clave = valorConfig_('ClaveAdmin');
  if (!clave || String(req.clave || '') !== String(clave)) throw new Error('Clave de administrador incorrecta');
}

function hoja_(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function leer_(nombre) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h || h.getLastRow() < 2) return [];
  const v = h.getDataRange().getValues();
  const head = v[0].map(String);
  return v.slice(1).filter(r => r.some(x => x !== '')).map(r => {
    const o = {};
    head.forEach((k, i) => { o[k] = r[i]; });
    return o;
  });
}

function escribir_(nombre, headers, filas) {
  const h = hoja_(nombre);
  h.clearContents();
  h.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (filas.length) {
    // texto plano para que "Sesion", "Muestra" y códigos no se conviertan
    h.getRange(2, 1, filas.length, headers.length).setNumberFormat('@').setValues(filas.map(f => f.map(String)));
  }
  h.setFrozenRows(1);
}

function leerAtributos_() {
  return leer_(HOJA.ATR).map(r => String(r.Nombre || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function valorConfig_(clave) {
  const filas = leer_(HOJA.CONFIG);
  const f = filas.find(r => String(r.Clave) === clave);
  return f ? f.Valor : '';
}

function setConfig_(clave, valor) {
  const h = hoja_(HOJA.CONFIG);
  if (h.getLastRow() < 1) h.getRange(1, 1, 1, 2).setValues([['Clave', 'Valor']]);
  const v = h.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === clave) { h.getRange(i + 1, 2).setValue(valor); return; }
  }
  h.appendRow([clave, valor]);
}

function unicos_(arr) {
  return Array.from(new Set(arr.filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function upsert_(hoja, obj) {
  let headers = [];
  if (hoja.getLastColumn() > 0) {
    headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
  }
  const nuevos = Object.keys(obj).filter(k => headers.indexOf(k) === -1);
  if (nuevos.length) {
    hoja.getRange(1, headers.length + 1, 1, nuevos.length).setValues([nuevos]);
    headers = headers.concat(nuevos);
    hoja.setFrozenRows(1);
  }
  const fila = headers.map(h => (obj[h] === undefined ? '' : obj[h]));
  const colId = headers.indexOf('id') + 1;
  if (colId > 0 && obj.id && hoja.getLastRow() > 1) {
    const enc = hoja.getRange(2, colId, hoja.getLastRow() - 1, 1)
      .createTextFinder(String(obj.id)).matchEntireCell(true).findNext();
    if (enc) {
      hoja.getRange(enc.getRow(), 1, 1, headers.length).setValues([fila]);
      return;
    }
  }
  hoja.appendRow(fila);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- puesta en marcha
// Ejecutar UNA vez desde el editor: crea las hojas, atributos de ejemplo y una clave de administrador.
function configurar() {
  if (!valorConfig_('ClaveAdmin')) {
    setConfig_('ClaveAdmin', String(Math.floor(100000 + Math.random() * 900000)));
  }
  if (!valorConfig_('Estudio')) setConfig_('Estudio', 'Análisis Sensorial');
  if (!leerAtributos_().length) {
    escribir_(HOJA.ATR, ['Nombre'], [
      'intensidad de color', 'tonalidad violeta', 'tonalidad rojiza', 'Frutilla', 'Canela', 'Ciruela',
      'Mermelada de frutos rojos', 'acetaldehido', 'alcohol', 'pimiento', 'herbáceo', 'vainilla', 'lácteo',
      'manzana roja', 'caramelo', 'manzana verde', 'Astringencia', 'Acidez', 'Dulce', 'Amargo',
    ].map(a => [a]));
  }
  hoja_(HOJA.SES); hoja_(HOJA.DIS);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Hoja 1') ||
             SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (sh && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1 && sh.getLastRow() === 0) {
    SpreadsheetApp.getActiveSpreadsheet().deleteSheet(sh);
  }
  Logger.log('Clave de administrador: ' + valorConfig_('ClaveAdmin'));
}
