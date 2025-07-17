// thumbnailer.js
// Recursively generates thumbnails for all images in htdocs/content/1-français and saves them in a /mini subfolder next to each image.
// Watches for new images and auto-generates thumbnails.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const chokidar = require('chokidar');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ROOT_DIR = path.join(__dirname, 'htdocs', 'content', '1-français');
const MINI_FOLDER = 'mini';
const THUMB_LANDSCAPE_WIDTH = 400; // px (doubled)
const THUMB_PORTRAIT_HEIGHT = 300; // px (doubled)

function isImage(file) {
  return IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

async function makeThumbnail(imagePath) {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath);
  const miniDir = path.join(dir, MINI_FOLDER);
  const thumbPath = path.join(miniDir, base);

  if (!fs.existsSync(miniDir)) {
    fs.mkdirSync(miniDir);
  }

  // Skip if thumbnail already exists and is newer than source
  if (fs.existsSync(thumbPath)) {
    const srcStat = fs.statSync(imagePath);
    const thumbStat = fs.statSync(thumbPath);
    if (thumbStat.mtimeMs > srcStat.mtimeMs) return;
  }

  // Get image metadata to determine orientation
  const metadata = await sharp(imagePath).metadata();
  let resizeOptions = {};
  if (metadata.width && metadata.height) {
    if (metadata.width >= metadata.height) {
      // Landscape or square: limit width
      resizeOptions.width = THUMB_LANDSCAPE_WIDTH;
    } else {
      // Portrait: limit height
      resizeOptions.height = THUMB_PORTRAIT_HEIGHT;
    }
  } else {
    // Fallback: use width
    resizeOptions.width = THUMB_LANDSCAPE_WIDTH;
  }

  await sharp(imagePath)
    .resize(resizeOptions)
    .toFile(thumbPath);
  console.log('Thumbnail created:', thumbPath);
}

function walkAndThumb(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // If this is a mini folder, delete all its contents before generating new thumbnails
      if (entry.name === MINI_FOLDER) {
        // Remove all files in the mini folder
        fs.readdirSync(fullPath).forEach(file => {
          const filePath = path.join(fullPath, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        });
        return;
      }
      walkAndThumb(fullPath);
    } else if (isImage(entry.name)) {
      makeThumbnail(fullPath).catch(console.error);
    }
  });
}

// Initial run
walkAndThumb(ROOT_DIR);

// Watch for new images
const watcher = chokidar.watch(ROOT_DIR, {
  ignored: new RegExp(`/${MINI_FOLDER}(/|$)`),
  persistent: true,
  ignoreInitial: true,
  depth: 99
});

watcher.on('add', filePath => {
  if (isImage(filePath)) {
    makeThumbnail(filePath).catch(console.error);
  }
});

console.log('Watching for new images in', ROOT_DIR);
