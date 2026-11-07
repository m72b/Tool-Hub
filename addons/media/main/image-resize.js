const { imageio } = globalThis.toolHubLib;

module.exports = {
  id: 'image-resize',
  actions: {
    listImages: imageio.listImages,
    read: imageio.read,
    write: imageio.write,
  },
};
