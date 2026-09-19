const imageio = require('../core/imageio');

module.exports = {
  id: 'image-resize',
  actions: {
    listImages: imageio.listImages,
    read: imageio.read,
    write: imageio.write,
  },
};
