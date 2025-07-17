const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const CONTENT_DIR = path.join(__dirname, 'htdocs/content');

// Recursively find all images in mini subfolders under a given directory
function findMiniImages(dir, relBase = '') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      if (item.name.toLowerCase() === 'mini') {
        // Add all images in this mini folder
        const miniDir = path.join(dir, item.name);
        const miniFiles = fs.readdirSync(miniDir).filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
        for (const f of miniFiles) {
          results.push(path.join(relBase, item.name, f).replace(/\\/g, '/'));
        }
      } else {
        // Recurse into subfolders
        results = results.concat(findMiniImages(path.join(dir, item.name), path.join(relBase, item.name)));
      }
    }
  }
  return results;
}

// API: List all mini images under a folder (recursively)
app.get('/api/listminis', async (req, res) => {
  let folder = req.query.folder || '';
  folder = folder.replace(/(\.\.[/\\])/g, '');
  const dirPath = path.join(CONTENT_DIR, decodeURIComponent(folder));
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    console.log('Directory not found:', dirPath);
    return res.json([]);
  }
  let result = [];
  async function findAllMiniImages(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'mini') {
          // Collect all images in this mini folder
          const miniFiles = await fs.promises.readdir(entryPath).catch(() => []);
          for (const file of miniFiles) {
            if (/\.(jpg|jpeg|png|gif)$/i.test(file)) {
              result.push(path.posix.join(
                path.relative(CONTENT_DIR, path.join(entryPath, file)).split(path.sep).join('/')
              ));
            }
          }
        } else {
          await findAllMiniImages(entryPath);
        }
      }
    }
  }
  await findAllMiniImages(dirPath);
  res.json(result);
});

function getFolderTree(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  return items
    .filter(item => item.isDirectory())
    .map(item => ({
      name: item.name,
      children: getFolderTree(path.join(dir, item.name))
    }));
}

app.get('/api/navtree', (req, res) => {
  res.json(getFolderTree(CONTENT_DIR));
});

app.get('/api/listfiles', (req, res) => {
  let folder = req.query.folder || '';
  folder = folder.replace(/(\.\.[/\\])/g, '');
  const dirPath = path.join(CONTENT_DIR, decodeURIComponent(folder));
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    console.log('Directory not found:', dirPath);
    return res.json([]);
  }
  fs.readdir(dirPath, (err, files) => {
    if (err) {
      console.log('Error reading directory:', dirPath, err);
      return res.json([]);
    }
    const fileList = files.filter(f => {
      try {
        return fs.statSync(path.join(dirPath, f)).isFile();
      } catch {
        return false;
      }
    });
    res.json(fileList);
  });
});

app.use(express.static(path.join(__dirname, 'htdocs')));
app.listen(3000, () => console.log('http://localhost:3000'));