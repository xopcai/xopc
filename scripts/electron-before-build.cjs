/**
 * Skip electron-builder dependency install/rebuild and automatic node_modules collection.
 * Runtime deps are prepared under `out/electron-pack/node_modules` by prepare-electron-pack-dir.mjs.
 */
module.exports = async function electronBeforeBuild() {
  return false;
};
