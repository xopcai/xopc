import {createRepository} from './repository.mjs';import {createCatalog} from './catalog.mjs';import {createReservations} from './reservations.mjs';
export function createInventory(seed) { const repository=createRepository(seed);const catalog=createCatalog(repository);return {...createReservations(repository,catalog),available:sku=>catalog.available(sku)}; }
