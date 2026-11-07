const { imageio } = globalThis.toolHubLib;
module.exports = { id: 'image-privacy', actions: { listImages: imageio.listImages, read: imageio.read, write: imageio.write } };
