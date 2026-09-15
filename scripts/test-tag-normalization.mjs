import assert from 'node:assert/strict';
import { normalizePublicMetadata } from '../submission-service/validator.mjs';

const base = { id:'tag-test', title:'Tag test', author:'Tester', ecuTarget:'MEGA144H7', firmwareSignature:'EpicEFI.TEST.1', validationStatus:'Unverified', classification:'Normal', files:{ msq:'tune.msq' } };
const tags = [...Array.from({ length: 20 }, (_, index) => `tag-${index}`), ' tag-0 ', ''];
const normalized = normalizePublicMetadata({ ...base, tags }, { hasIni:false, publishedAt:'2026-09-15' });
assert.equal(normalized.tags.length, 20);
console.log('Tag normalization test: PASS');
