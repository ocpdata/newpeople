import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCompatibleSubtypeOptions,
  resolveCompatibleSubtypeValue,
} from './campaignCompatibility.js';

test('filters out incompatible subtypes for captacion de leads', () => {
  const policyByType = {
    captacion_de_leads: {
      permitido: ['landing_page', 'anuncios_busqueda'],
      permitido_con_aprobacion: ['whatsapp'],
    },
  };

  const options = getCompatibleSubtypeOptions(
    policyByType,
    ['correo_masivo', 'landing_page', 'anuncios_busqueda', 'whatsapp'],
    'captacion_de_leads',
  );

  assert.deepEqual(options.map((entry) => entry.value), [
    'landing_page',
    'anuncios_busqueda',
    'whatsapp',
  ]);
});

test('falls back to the first compatible subtype when the current one is blocked', () => {
  const policyByType = {
    captacion_de_leads: {
      permitido: ['landing_page', 'anuncios_busqueda'],
      permitido_con_aprobacion: ['whatsapp'],
    },
  };

  const resolved = resolveCompatibleSubtypeValue(
    policyByType,
    ['correo_masivo', 'landing_page', 'anuncios_busqueda', 'whatsapp'],
    'captacion_de_leads',
    'correo_masivo',
  );

  assert.equal(resolved, 'landing_page');
});
