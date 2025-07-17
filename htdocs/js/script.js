// Set initial viewport width and height as CSS variables ONCE
if (!document.documentElement.style.getPropertyValue('--init-vw')) {
  document.documentElement.style.setProperty('--init-vw', window.innerWidth + 'px');
  document.documentElement.style.setProperty('--init-vh', window.innerHeight + 'px');
}

// ==========================
// Utility: Hash Manipulation
// ==========================

function encodePathSegments(segments) {
  return segments.map(encodeURIComponent);
}

function decodePathSegments(segments) {
  return segments.map(decodeURIComponent);
}

function getHashPathSegments(rawHash) {
  return decodePathSegments(
    rawHash.replace(/\/(img|expoimg):[^/]+$/, '')
      .split('/')
      .filter(Boolean)
  );
}

function buildHashFromSegments(segments) {
  return segments.map(encodeURIComponent).join('/');
}

function getOverlayFragment(rawHash) {
  const match = rawHash.match(/\/(img|expoimg):[^/]+$/);
  return match ? match[0] : '';
}

function updateHashFromSegments(segments, overlayFragment = '') {
  window.location.hash = segments.length ? '#' + buildHashFromSegments(segments) + overlayFragment : '';
}

function updateHash(folderPath) {
  const segments = (folderPath || '').split('/').filter(Boolean);
  updateHashFromSegments(segments);
}

// ==========================
// Navigation History Handling
// ==========================

let hashHistory = [];
let isBackNav = false;

window.addEventListener('hashchange', () => {
  if (!isBackNav) {
    hashHistory.push(window.location.hash);
  }
  isBackNav = false;
});

function back() {
  // Always use getBackTargetHash to determine the next hash
  const nextHash = getBackTargetHash();
  window.location.hash = nextHash;
}

function getBackTargetHash() {
  const rawHash = window.location.hash.replace(/^#/, '');
  const overlayFragment = getOverlayFragment(rawHash);
  let segments = getHashPathSegments(rawHash);

  if (overlayFragment) {
    // Remove overlay fragment
    return '#' + rawHash.replace(/\/(img|expoimg):[^/]+$/, '');
  }

  // If the path ends with List/xxx or Exposition/xxx, go up two segments
  if (segments.length >= 2 && (
    (segments[segments.length - 2] === 'List') ||
    (segments[segments.length - 2] === 'Exposition')
  )) {
    return '#' + buildHashFromSegments(segments.slice(0, -2));
  }

  // Otherwise, go up one segment
  if (segments.length > 0) {
    return '#' + buildHashFromSegments(segments.slice(0, -1));
  }
  return '#';
}

// ==========================
// Navigation: Load & Render
// ==========================

let selectedLanguage = null;
let currentProjectPath = null;

function loadFromHash() {
  const rawHash = decodeURI(window.location.hash.replace(/^#/, ''));
  if (!rawHash && !window._hasLoadedOnce) {
    window._hasLoadedOnce = true;
    renderRootNavMenu();
    hideProjectList();
    return;
  }

  if (!rawHash) {
    goHome();
    hideProjectList();
    return;
  }

  fetchNavTree().then(tree => {
    const parts = getHashPathSegments(rawHash);
    const { node, folderPath } = resolveNodeFromPath(tree, parts);

    // Show/hide project list based on path or if current node has a List child
    const isListPath = /\/List(\/|$)/.test(folderPath);
    const hasListChild = node && node.children && node.children.some(child => child.name === 'List');

    // --- PATCH: If on a List subfolder, show parent project list and highlight correct link ---
    if (isListPath && parts.length > 2) {
      // Find parent folder path (up to /List)
      const listIdx = parts.lastIndexOf('List');
      const parentParts = parts.slice(0, listIdx);
      const parentFolderPath = parentParts.join('/');
      // Find parent List node
      const { node: parentNode } = resolveNodeFromPath(tree, parentParts);
      if (parentNode && parentNode.children) {
        const listNode = parentNode.children.find(child => child.name === 'List');
        if (listNode) {
          renderProjectList(listNode, parentFolderPath);
          showProjectList();
          setTimeout(updateProjectListActive, 0);
        }
      }
    } else if (isListPath || hasListChild) {
      showProjectList();
    } else {
      hideProjectList();
    }

    // Only apply exposition style if not in Exposition mode
    if (node && node.name === 'Exposition') {
      const contentBox = document.querySelector('.content_box');
      if (contentBox) contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
    } else {
      applyExpositionStyleIfNeeded(node);
    }

    if (!node) {
      goHome();
      hideProjectList();
      return;
    }

    if (node.name === 'Exposition') {
      loadExpositionContent(folderPath, node);
      slideInNavList('Exposition');
      return;
    }

    if (node.name === 'List') {
      renderDynamicNav([node], folderPath);
      loadContentFromFolder(folderPath);
      slideInNavList('List');
      return;
    }

    renderDynamicNav([node], folderPath);
    loadContentFromFolder(folderPath);
    slideInNavList(node.name);
  });
}

function showProjectList() {
  const projectList = document.querySelector('.project_list');
  const projectOverlay = document.querySelector('.project_overlay');
  const navListContainer = document.querySelector('.nav_list-container');
  const navListOverflow = document.querySelector('.nav_list-overflow');
  if (projectList) projectList.style.display = '';
  if (projectOverlay) {
    projectOverlay.style.display = '';
    if (!projectOverlay.classList.contains('active')) {
      projectOverlay.classList.remove('active', 'hidden');
      projectOverlay.style.animation = '';
      void projectOverlay.offsetWidth;
      projectOverlay.style.animation = '';
      slideOutNavList(() => projectOverlay.classList.add('active'));
    }
  }
  if (navListContainer) navListContainer.style.display = 'none';
  if (navListOverflow) navListOverflow.style.pointerEvents = 'none';
  if (projectOverlay) projectOverlay.style.pointerEvents = 'auto';
}

function hideProjectList() {
  const projectList = document.querySelector('.project_list');
  const projectOverlay = document.querySelector('.project_overlay');
  const navListContainer = document.querySelector('.nav_list-container');
  const navListOverflow = document.querySelector('.nav_list-overflow');
  if (projectList) projectList.style.display = 'none';
  if (projectOverlay) projectOverlay.style.display = 'none';
  if (navListContainer) navListContainer.style.display = '';
  if (navListOverflow) navListOverflow.style.pointerEvents = '';
  if (projectOverlay) projectOverlay.style.pointerEvents = '';
}

function fetchNavTree() {
  return fetch('/api/navtree').then(res => res.json());
}

function resolveNodeFromPath(tree, parts) {
  let folderPath = '';
  let node = null;
  let subtree = tree;

  for (const part of parts) {
    node = subtree.find(n => n.name === part);
    if (!node) break;
    folderPath += (folderPath ? '/' : '') + node.name;
    subtree = node.children || [];
  }

  return { node, folderPath };
}

function applyExpositionStyleIfNeeded(node) {
  const contentBox = document.querySelector('.content_box');
  if (node && node.children && node.children.some(child => child.name === 'Exposition')) {
    if (contentBox) contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
  } else {
    if (contentBox) contentBox.style.backgroundColor = '';
  }
}

function renderRootNavMenu() {
  fetchNavTree().then(tree => {
    const nav = document.getElementById('dynamic-nav');
    nav.innerHTML = '';

    const section = document.createElement('section');
    section.className = 'nav_list nav_intro';
    section.dataset.prefix = 'I';

    tree.forEach(node => {
      const label = cleanName(node.name, { stripNumeric: true });
      const btn = document.createElement('a');
      btn.className = 'nav_button';
      btn.href = '#';
      btn.innerHTML = `<p>${label}</p>`;
      btn.onclick = e => {
        e.preventDefault();
        selectedLanguage = node.name;
        updateHash(node.name);
      };
      section.appendChild(btn);
    });

    nav.appendChild(section);
    slideInNavList('I');
  });
}

function goHome() {
  updateHash(selectedLanguage || '');
}

window.goHome = goHome;

// ==========================
// Helpers: Name Processing
// ==========================

/**
 * Cleans a name string by removing optional year in parentheses and/or numeric prefix.
 * @param {string} name - The name to clean.
 * @param {object} [options] - Options for cleaning.
 * @param {boolean} [options.stripYear] - Remove year in parentheses at start.
 * @param {boolean} [options.stripNumeric] - Remove numeric prefix at start.
 * @returns {string} Cleaned name.
 */
function cleanName(name, options = { stripYear: false, stripNumeric: false }) {
  let result = name;
  if (options.stripYear) {
    result = result.replace(/^\(([^)]+)\)/, '');
  }
  if (options.stripNumeric) {
    result = result.replace(/^\d+[-_\s]?/, '');
  }
  return result.trim();
}

// ==========================
// Navigation: Dynamic Render
// ==========================

function renderDynamicNav(tree, folderPath) {
  const nav = document.getElementById('dynamic-nav');
  nav.innerHTML = '';
  tree.forEach(node => {
    const section = createDynamicNavSection(node, folderPath);
    if (section) nav.appendChild(section);
  });
}

function createDynamicNavSection(node, folderPath) {
  const section = document.createElement('section');
  section.className = 'nav_list';
  section.dataset.prefix = node.name;

  if (!node.children || !node.children.length) return section;

  const expositionNode = node.children.find(child => child.name === 'Exposition');
  if (expositionNode) {
    const freewall = document.getElementById('freewall');
    if (freewall) freewall.style.display = 'none';
    return null;
  }

  const listNode = node.children.find(child => child.name === 'List');
  if (listNode) {
    renderProjectList(listNode, folderPath);
    return null;
  }

  node.children.forEach(child => {
    // Exclude any subfolder named 'mini' (case-insensitive)
    if (typeof child.name === 'string' && child.name.trim().toLowerCase() === 'mini') return;
    const label = cleanName(child.name, { stripNumeric: true });
    const btn = document.createElement('a');
    btn.className = 'nav_button';
    btn.href = '#';
    btn.innerHTML = `<p>${label}</p>`;
    btn.onclick = e => {
      e.preventDefault();
      const newPath = folderPath ? `${folderPath}/${child.name}` : child.name;
      updateHash(newPath);
    };
    section.appendChild(btn);
  });

  return section;
}


function renderProjectList(listNode, basePath) {
  // Ensure basePath does not already include /List
  let listPath = basePath;
  if (!/\/(List)$/.test(listPath)) {
    listPath = listPath ? `${listPath}/List` : 'List';
  }

  // Sort by finishing year (if present), or starting year if only one year, descending
  const sortedChildren = [...(listNode.children || [])].sort((a, b) => {
    const enda = extractFinishingYear(a.name);
    const endb = extractFinishingYear(b.name);
    // Descending order: higher finishing year (or starting year if only one) comes first
    if (endb !== enda) return endb - enda;
    // If finishing year is the same, fallback to starting year (descending)
    const ya = extractYearForSort(a.name);
    const yb = extractYearForSort(b.name);
    return yb - ya;
  });

// Helper: extract finishing year (YYYY) from (YYYY-YYYY) or (YYYY-) or (YYYY)
// (Moved to top-level for DRY)
function extractFinishingYear(name) {
  const match = name.match(/^\((\d{4})(?:-(\d{0,4}))?\)/);
  if (match) {
    const start = parseInt(match[1], 10);
    const end = match[2];
    if (end && end.length === 4) {
      return parseInt(end, 10); // (YYYY-YYYY)
    } else if (end === "") {
      return 9999; // (YYYY-)
    } else {
      return start; // (YYYY) — use start year as finishing year for sorting
    }
  }
  return 0;
}

  // Ensure nav_list-container is mutually exclusive with project_overlay
  const navOverflow = document.querySelector('.nav_overflow');
  if (navOverflow) {
    // Hide all nav_list-container children
    Array.from(navOverflow.children).forEach(child => {
      if (child.classList.contains('nav_list-container')) {
        child.style.display = 'none';
      }
    });
  }

  const projectList = document.querySelector('.project_list');
  const projectOverlay = document.querySelector('.project_overlay');
  if (projectList) projectList.innerHTML = '';

  sortedChildren.forEach(subChild => {
    // Skip any subfolder/project named 'mini' (case-insensitive)
    if (typeof subChild.name === 'string' && subChild.name.trim().toLowerCase() === 'mini') return;
    const subLabel = cleanName(subChild.name, { stripYear: true, stripNumeric: true });
    const yearSpan = getYearSpanFromName(subChild.name);
    const path = `${listPath}/${subChild.name}`;
    // Use hash for selection
    const isSelected = decodeURIComponent(window.location.hash.replace(/^#/, '')) === path;

    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.width = '100%';

    li.innerHTML = `
      <a href="#" style="flex:1;text-align:left;" ${isSelected ? 'class="active"' : ''} data-path="${path}">${subLabel}</a>
      ${yearSpan ? `<span style="flex:0 0 auto;text-align:right;color:var(--light-grey);font-size:12px;padding-left:1em;">${yearSpan}</span>` : ''}
    `;

    li.querySelector('a').onclick = e => {
      e.preventDefault();
      window.currentProjectPath = path;
      updateHash(path);
      // Update active state immediately
      setTimeout(updateProjectListActive, 0);
    };

    if (projectList) projectList.appendChild(li);
  });

  // After rendering, update the active state
  setTimeout(updateProjectListActive, 0);

  if (projectOverlay) {
    projectOverlay.style.display = 'block';
    projectOverlay.classList.remove('active', 'hidden');
    projectOverlay.style.animation = '';
    void projectOverlay.offsetWidth;
    slideOutNavList(() => projectOverlay.classList.add('active'));
  }
}

// Helper: extract year span in (YYYY), (YYYY-), or (YYYY-YYYY) format from folder name
function getYearSpanFromName(name) {
  // Match (YYYY), (YYYY-), or (YYYY-YYYY) at the start
  const match = name.match(/^\((\d{4})(?:-(\d{0,4}))?\)/);
  if (match) {
    const start = match[1];
    const end = match[2];
    if (end === undefined) {
      return `${start}`;
    } else if (end === "") {
      return `${start}-&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`;
    } else {
      return `${start}-${end}`;
    }
  }
  return '';
}


// Helper: for sorting, extract the first year as a number (YYYY or YYYY-YYYY)
function extractYearForSort(name) {
  const match = name.match(/^\((\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
}

// Helper to update the active state of .project_list a based on hash
function updateProjectListActive() {
  const hashPath = decodeURIComponent(window.location.hash.replace(/^#/, ''));
  document.querySelectorAll('.project_list a[data-path]').forEach(a => {
    if (a.getAttribute('data-path') === hashPath) {
      a.classList.add('active');
      a.style.color = '#fff';
      a.style.textShadow = '0 0 8px #fff, 0 0 16px #fff';
    } else {
      a.classList.remove('active');
      a.style.color = '';
      a.style.textShadow = '';
    }
  });
}


// ==========================
// Helpers: Name Processing
// ==========================
// (extractYearFromName removed as redundant)

// ==========================
// Content: Folder Loader
// ==========================

function loadContentFromFolder(folderPath) {
  const contentBox = document.querySelector('.content_box');
  // Always clear .content_box before loading new content (prevents txt from lingering)
  if (contentBox) {
    contentBox.innerHTML = '';
    // Reset styles to default for .content_box
    contentBox.removeAttribute('style');
  }
  const isListFolder = /List/i.test(folderPath);
  if (isListFolder) {
    loadListContent(folderPath);
  } else {
    loadDefaultFolderContent(folderPath);
  }
}

// --------------------------
// List-style content loader
// --------------------------

function loadListContent(folderPath) {
  setListOrExpositionUI(true);
  const contentBox = document.querySelector('.content_box');
  // Ensure .project-docs-container exists
  let projectDocs = contentBox ? contentBox.querySelector('.project-docs-container') : null;
  if (!projectDocs && contentBox) {
    projectDocs = document.createElement('div');
    projectDocs.className = 'project-docs-container';
    contentBox.appendChild(projectDocs);
  }
  const target = projectDocs;
  const blueHue = document.getElementById('blue_hue');
  const encodedPath = encodeFolderPath(folderPath);

  fetch(`/api/listfiles?folder=${encodeURIComponent(folderPath)}`)
    .then(res => res.json())
    .then(files => {

      if (!files.length) {
        // No files: clear content and revert to freewall/underlayer/bluehue
        if (target) target.innerHTML = '';
        refreshFw();
        return;
      }

      // Files found: hide freewall, underlayer, bluehue and set content box bg
      const contentBox = document.querySelector('.content_box');
      const blueHue = document.getElementById('blue_hue');
      const underlayer = document.getElementById('underlayer');
      const freewall = document.getElementById('freewall');
      if (freewall) freewall.style.display = 'none';
      if (underlayer) underlayer.style.display = 'none';
      if (blueHue) blueHue.style.display = 'none';
      if (contentBox) contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--light-grey').trim();

      const images = files.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
      const txtFiles = files.filter(f => /\.txt$/i.test(f));
      // If exactly one txt file and no images, show in .test div (not directly in .content_box)
      if (txtFiles.length === 1 && images.length === 0) {
        if (target) {
          target.innerHTML = 'Loading…';
          fetch(`/content/${encodedPath}/${encodeURIComponent(txtFiles[0])}`)
            .then(r => r.text())
            .then(text => {
              target.innerHTML = text;
              target.style.padding = '2rem';
              target.style.width = 'auto';
              target.style.height = 'auto';
            });
        }
      } else {
        const textFile = txtFiles.length ? txtFiles[0] : null;
        target.innerHTML = createContentHTML(images, textFile, encodedPath, "list");
        // Hide .project-docs-text if no text file (in case of dynamic changes)
        if (!textFile) {
          const docsText = target.querySelector('.project-docs-text');
          if (docsText) docsText.style.display = 'none';
        }
        bindImageOverlayClicks('img[data-img]', 'expoimg');
        initializeSwiper(images, encodedPath);
        if (textFile) loadAndRenderTextFile(encodedPath, textFile, '.project-docs-txtcontent');
      }
      // blueHue is now only managed by refreshFw
    })
    .catch(() => {
      renderMessageContent(target, '<em>Contenu indisponible<br>(Erreur lors du chargement des fichiers)</em>');
      refreshFw();
    });
}

function initializeSwiper(images, encodedPath) {
  setTimeout(() => {
    document.querySelectorAll('.swiper').forEach(swiper => swiper.swiper?.destroy(true, true));
    if (images.length && window.Swiper) {
      new Swiper('.project-docs-images.swiper', {
        spaceBetween: 10,
        navigation: {
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev'
        },
        slidesPerView: 1,
        effect: 'fade',
        fadeEffect: { crossFade: true },
        loop: true,
        autoplay: {
          delay: 10000,
          disableOnInteraction: true
        },
        pagination: {
          el: '.project-docs-pagination',
          clickable: true,
          renderBullet: (i, className) => {
            // Defensive: handle double slashes, missing/extra slashes, and always encode
            let safePath = encodedPath.replace(/\/+/g, '/').replace(/(^\/|\/$)/g, '');
            let safeFile = images[i];
            // Remove any leading slashes from file
            safeFile = safeFile.replace(/^\/+/, '');
            // Always encode file name
            const encodedFile = encodeURIComponent(safeFile);
            // Compose the URL
            const url = `/content/${safePath ? safePath + '/' : ''}${encodedFile}`;
            // Escape apostrophes for CSS url('') context
            const cssUrl = url.replace(/'/g, "%27");
            return `<span class="${className}" style="background-image:url(\'${cssUrl}\')"></span>`;
          }
        }
      });
    }
  }, 0);
}

// --------------------------
// Default folder loader
// --------------------------

function loadDefaultFolderContent(folderPath) {
  setListOrExpositionUI(false);
  const contentBox = document.querySelector('.content_box');
    // Reset .content_box background to default when not in Exposition
  if (contentBox) contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--light-grey').trim();
  // Ensure .test exists for Exposition, or .project-docs-container for List
  let testDiv = contentBox ? contentBox.querySelector('.test') : null;
  if (!testDiv && contentBox) {
    testDiv = document.createElement('div');
    testDiv.className = 'test';
    contentBox.appendChild(testDiv);
  }
  const target = testDiv;
  const blueHue = document.getElementById('blue_hue');
  const encodedPath = encodeFolderPath(folderPath);

  fetch('/api/navtree')
    .then(res => res.json())
    .then(tree => {
      const node = findNodeByPath(tree, folderPath.split('/'));
      const hasExposition = node?.children?.some(child => child.name === 'Exposition');
      if (hasExposition) {
        // If Exposition, display its contents directly (no project-docs-container)
        loadExpositionContent(folderPath, node.children.find(child => child.name === 'Exposition'));
        return;
      }

      fetch(`/api/listfiles?folder=${encodeURIComponent(folderPath)}`)
        .then(res => res.json())
        .then(files => {

          if (!files.length) {
            // No files: clear content and revert to freewall/underlayer/bluehue
            if (target) target.innerHTML = '';
            refreshFw();
            return;
          }

          // Files found: hide freewall, underlayer, bluehue and set content box bg
          const contentBox = document.querySelector('.content_box');
          const blueHue = document.getElementById('blue_hue');
          const underlayer = document.getElementById('underlayer');
          const freewall = document.getElementById('freewall');
          if (freewall) freewall.style.display = 'none';
          if (underlayer) underlayer.style.display = 'none';
          if (blueHue) blueHue.style.display = 'none';
          if (contentBox) contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--light-grey').trim();

          const images = files.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
          const txtFiles = files.filter(f => /\.txt$/i.test(f));
          // If exactly one txt file and no images, show in .test div (not directly in .content_box)
          if (txtFiles.length === 1 && images.length === 0) {
            if (target) {
              target.innerHTML = 'Loading…';
              fetch(`/content/${encodedPath}/${encodeURIComponent(txtFiles[0])}`)
                .then(r => r.text())
                .then(text => {
                  target.innerHTML = text;
                  target.style.color = 'var(--background-color)';
                });
            }
          } else {
            const textFile = txtFiles.length ? txtFiles[0] : null;
            target.innerHTML = createContentHTML(images, textFile, encodedPath, "default");
            if (textFile) loadAndRenderTextFile(encodedPath, textFile, '.project-docs-text');
          }
          // blueHue is now only managed by refreshFw
        })
        .catch(() => {
          renderMessageContent(target, '<em>Contenu indisponible<br>(Erreur lors du chargement des fichiers)</em>');
          refreshFw();
        });
    });
}

// --------------------------
// Helpers for file loading
// --------------------------

function loadAndRenderTextFile(encodedPath, fileName, selector) {
  fetch(`/content/${encodedPath}/${encodeURIComponent(fileName)}`)
    .then(r => r.text())
    .then(text => {
      const container = document.querySelector(selector);
      if (container) container.innerHTML = text;
    });
}

function findNodeByPath(tree, parts) {
  if (!parts.length) return null;
  const [head, ...tail] = parts;
  const node = tree.find(n => n.name === head);
  return tail.length ? findNodeByPath(node?.children || [], tail) : node;
}

function encodeFolderPath(folderPath) {
  return encodePathSegments(folderPath.split('/')).join('/');
}

function renderMessageContent(container, message = "") {
  if (container) container.innerHTML = `<p>${message}</p>`
}

// ==========================
// Overlay Handling (img/expoimg)
// ==========================

function createOrGetOverlay(type, className) {
  const overlayId = `${type}-overlay`;
  let overlay = document.getElementById(overlayId);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = className;
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.display = 'none';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const rawHash = window.location.hash.replace(/^#/, '');
        const newHash = rawHash.replace(new RegExp(`/` + type + `:[^/]+$`), '');
        window.location.hash = '#' + newHash;
      }
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function handleOverlayFromHash(type) {
  const rawHash = window.location.hash.replace(/^#/, '');
  const overlayFragment = getOverlayFragment(rawHash);
  const className = type === 'img' ? 'img-overlay' : (type === 'expoimg' ? 'expo-img-overlay' : `${type}-overlay`);
  const overlay = createOrGetOverlay(type, className);

  if (overlayFragment && overlayFragment.startsWith(`/${type}:`)) {
    let folderPath = rawHash.replace(new RegExp(`/` + type + `:[^/]+$`), '');
    const imgFile = overlayFragment.split(':')[1];
    // For expoimg, try to find the subfolder from the currently visible .test div
    if (type === 'expoimg') {
      // Find the image element with the matching data-expoimg
      let exposubfolder = null;
      const testDiv = document.querySelector('.test');
      if (testDiv) {
        // Find the img[data-expoimg] with the correct filename
        const imgElem = Array.from(testDiv.querySelectorAll('img[data-expoimg]')).find(el => encodeURIComponent(el.getAttribute('data-expoimg')) === imgFile);
        if (imgElem && imgElem.hasAttribute('data-exposubfolder')) {
          exposubfolder = imgElem.getAttribute('data-exposubfolder');
        }
      }
      if (exposubfolder) {
        folderPath = folderPath.replace(/\/Exposition$/, '');
        folderPath += `/Exposition/${encodeURIComponent(exposubfolder)}`;
      } else if (!/\/Exposition$/.test(folderPath)) {
        folderPath += '/Exposition';
      }
    }
    overlay.innerHTML = '';
    const img = document.createElement('img');
    img.src = `/content/${folderPath}/${encodeURIComponent(imgFile)}`;
    img.className = className === 'img-overlay' ? 'overlay-img' : (className === 'expo-img-overlay' ? 'expo-overlay-img' : 'overlay-img');
    overlay.appendChild(img);
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  } else {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    document.body.style.overflow = '';
  }
}


// ==========================
// Consolidated hashchange event listener
// ==========================

// Remove duplicate hashchange listeners and history logic
// Only one consolidated hashchange event listener should exist

// Remove the old hashHistory push logic from the previous hashchange event
// Instead, handle history in a single place

window.addEventListener('hashchange', () => {
  // Maintain navigation history only once
  if (!window.isBackNav) {
    window.hashHistory = window.hashHistory || [];
    window.hashHistory.push(window.location.hash);
  }
  window.isBackNav = false;

  handleOverlayFromHash('img');
  handleOverlayFromHash('expoimg');
  loadFromHash();
  setTimeout(() => {
    if (/\/List\//.test(decodeURIComponent(window.location.hash))) {
      showProjectList();
      slideInNavList('List');
      updateProjectListActive();
    }
  }, 0);
});

// ==========================
// UI Transitions & Exposition
// ==========================

function setListOrExpositionUI(isActive, isExposition = false) {
  // This function is now a no-op; all logic for freewall, underlayer, and blue_hue is handled in refreshFw
  // (kept for compatibility with existing calls)
  return;
}

function slideOutNavList(cb) {
  const navOverflow = document.querySelector('.nav_overflow');
  if (!navOverflow) return;
  // Find the visible child (nav_list-container or project_overlay)
  const activeChild = Array.from(navOverflow.children).find(
    el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none'
  );
  if (!activeChild) {
    if (typeof cb === 'function') cb();
    return;
  }
  // Remove any previous animation classes
  activeChild.classList.remove('slide-in-nav-list');
  activeChild.classList.remove('slide-out-nav-list');
  // Trigger slide out
  activeChild.classList.add('slide-out-nav-list');
  function handleOutEnd(e) {
    if (e.target !== activeChild) return;
    activeChild.classList.remove('slide-out-nav-list');
    activeChild.style.display = 'none';
    activeChild.removeEventListener('animationend', handleOutEnd);
    if (typeof cb === 'function') cb();
  }
  activeChild.addEventListener('animationend', handleOutEnd);
}

function slideInNavList(targetClass) {
  const navOverflow = document.querySelector('.nav_overflow');
  if (!navOverflow) return;
  // Find the child to show (nav_list-container or project_overlay)
  const target = Array.from(navOverflow.children).find(el => el.classList.contains(targetClass));
  if (!target) return;
  // Remove any previous animation classes
  target.classList.remove('slide-in-nav-list');
  target.classList.remove('slide-out-nav-list');
  // Make visible
  target.style.display = '';
  // Trigger slide in
  target.classList.add('slide-in-nav-list');
  function handleInEnd(e) {
    if (e.target !== target) return;
    target.classList.remove('slide-in-nav-list');
    target.removeEventListener('animationend', handleInEnd);
  }
  target.addEventListener('animationend', handleInEnd);
}

function refreshFw() {
  // Centralized management of freewall, underlayer, and blue_hue
  const contentBox = document.querySelector('.content_box');
  const blueHue = document.getElementById('blue_hue');
  let underlayer = document.getElementById('underlayer');
  let freewall = document.getElementById('freewall');



  // If a project or file is being displayed (content_box has background or subdivs), remove/hide all three
  // Also, if contentBox has subdivs (children other than underlayer/freewall/blue_hue), treat as content active
  let isContentActive = false;
  if (contentBox) {
    // Check for subdivs (children that are not underlayer, freewall, or blue_hue)
    const nonBgChildren = Array.from(contentBox.children).filter(
      el => !['underlayer', 'freewall', 'blue_hue'].includes(el.id) && el.innerHTML.trim() !== '' && el.offsetParent !== null
    );
    if (nonBgChildren.length > 0) {
      isContentActive = true;
      // Set background to var(--light-grey)
      contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--light-grey').trim();
    } else {
      // If not content active, reset background
      contentBox.style.backgroundColor = '';
    }
  }
  // Also treat Exposition as content active
  if (!isContentActive && window.currentProjectPath && /\/Exposition(\/|$)/.test(window.currentProjectPath)) {
    isContentActive = true;
  }

  if (isContentActive) {
    // Remove freewall
    if (freewall && freewall.parentNode) freewall.parentNode.removeChild(freewall);
    // Hide underlayer
    if (underlayer) underlayer.style.display = 'none';
    // Hide blue hue
    if (blueHue) blueHue.style.display = 'none';
    return;
  } else if (contentBox) {
    // Reset background if not content active
    contentBox.style.backgroundColor = '';
  }

  // Otherwise, show/generate all three
  // Show blue hue (standard, no active class)
  if (blueHue) blueHue.style.display = '';

  // Show underlayer
  if (!underlayer) {
    if (contentBox) {
      underlayer = document.createElement('div');
      underlayer.id = 'underlayer';
      contentBox.appendChild(underlayer);
    }
  }
  if (underlayer) {
    underlayer.style.display = '';
    underlayer.innerHTML = "";
  }

  // Remove and recreate freewall
  if (freewall && freewall.parentNode) freewall.parentNode.removeChild(freewall);
  freewall = document.createElement('div');
  freewall.id = 'freewall';
  freewall.style.opacity = '1';
  freewall.style.display = 'grid';
  freewall.style.width = '100%';
  freewall.style.height = '100%';
  const columns = 4, rows = 7, totalCells = columns * rows;
  freewall.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  freewall.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  // Insert after underlayer if possible
  if (underlayer && underlayer.parentNode) {
    underlayer.parentNode.insertBefore(freewall, underlayer.nextSibling);
  } else if (contentBox) {
    contentBox.appendChild(freewall);
  }

  // Populate freewall and underlayer with mini images from API
  const positions = Array.from({ length: totalCells }, (_, i) => ({ col: (i % columns) + 1, row: Math.floor(i / columns) + 1 })).sort(() => Math.random() - 0.5);
  // Determine the folder to use for mini images based on navigation context
  let folderPath = '';
  if (window.location.hash && window.location.hash !== '#') {
    // Remove overlay fragment if present
    const rawHash = window.location.hash.replace(/^#/, '').replace(/\/(img|expoimg):[^/]+$/, '');
    folderPath = decodeURIComponent(rawHash);
  } else {
    // Default to 1-français if present, else root
    folderPath = '1-français';
  }
  console.log('[freewall] Using folderPath for minis:', folderPath);
  fetch(`/api/listminis?folder=${encodeURIComponent(folderPath)}`)
    .then(res => res.json())
    .then(miniImages => {
      // Helper to fill up to totalCells with unique images, prioritizing local, then global
      function fillWithMinis(local, global, total) {
        const used = new Set(local);
        const result = local.slice();
        const globalPool = global.filter(x => !used.has(x));
        while (result.length < total && globalPool.length > 0) {
          // Pick a random image from the remaining global pool
          const idx = Math.floor(Math.random() * globalPool.length);
          result.push(globalPool.splice(idx, 1)[0]);
        }
        return result;
      }
      if (!Array.isArray(miniImages) || miniImages.length === 0) {
        // Try fallback: get all mini images from root
        fetch('/api/listminis?folder=')
          .then(res => res.json())
          .then(rootMinis => {
            if (Array.isArray(rootMinis) && rootMinis.length > 0) {
              const fillMinis = fillWithMinis([], rootMinis, totalCells);
              const shuffled = fillMinis.slice().sort(() => Math.random() - 0.5);
              let loaded = 0;
              function loadNextMini(index) {
                if (loaded >= totalCells || index >= shuffled.length) return;
                const position = positions[loaded];
                const img = new Image();
                img.src = `/content/${shuffled[index]}`;
                img.onload = () => {
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    const cell = document.createElement("div");
                    cell.className = "underlayer-cell";
                    cell.style.gridColumn = position.col;
                    cell.style.gridRow = position.row;
                    cell.style.backgroundColor = `rgba(${Math.floor(Math.random() * 70) + 120}, ${Math.floor(Math.random() * 30) + 170}, ${Math.floor(Math.random() * 30) + 170}, ${Math.random() * 0.5 + 0.3})`;
                    cell.style.opacity = "0";
                    cell.style.transition = "opacity 10ms";
                    if (underlayer) underlayer.appendChild(cell);
                    setTimeout(() => { cell.style.opacity = "1"; }, loaded * 30);
                    setTimeout(() => {
                      const gridItem = document.createElement("div");
                      gridItem.className = "grid-item";
                      gridItem.style.gridColumn = position.col;
                      gridItem.style.gridRow = position.row;
                      gridItem.style.opacity = "0";
                      gridItem.style.transition = "opacity 600ms";
                      gridItem.appendChild(img);
                      freewall.appendChild(gridItem);
                      setTimeout(() => { gridItem.style.opacity = "1"; }, 50);
                    }, loaded * 30 + 100);
                    loaded++;
                  }
                  loadNextMini(index + 1);
                };
                img.onerror = () => { loadNextMini(index + 1); };
              }
              loadNextMini(0);
            } else {
              // No mini images anywhere, fallback to background images
              const imageFolder = "assets/background/";
              const indexes = Array.from({ length: 542 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
              let loaded = 0;
              function loadNextImage(index) {
                if (loaded >= totalCells || index >= indexes.length) return;
                const position = positions[loaded];
                const img = new Image();
                img.src = `${imageFolder}image (${indexes[index]}).jpg`;
                img.onload = () => {
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    const cell = document.createElement("div");
                    cell.className = "underlayer-cell";
                    cell.style.gridColumn = position.col;
                    cell.style.gridRow = position.row;
                    cell.style.backgroundColor = `rgba(${Math.floor(Math.random() * 70) + 120}, ${Math.floor(Math.random() * 30) + 170}, ${Math.floor(Math.random() * 30) + 170}, ${Math.random() * 0.5 + 0.3})`;
                    cell.style.opacity = "0";
                    cell.style.transition = "opacity 10ms";
                    if (underlayer) underlayer.appendChild(cell);
                    setTimeout(() => { cell.style.opacity = "1"; }, loaded * 30);
                    setTimeout(() => {
                      const gridItem = document.createElement("div");
                      gridItem.className = "grid-item";
                      gridItem.style.gridColumn = position.col;
                      gridItem.style.gridRow = position.row;
                      gridItem.style.opacity = "0";
                      gridItem.style.transition = "opacity 600ms";
                      gridItem.appendChild(img);
                      freewall.appendChild(gridItem);
                      setTimeout(() => { gridItem.style.opacity = "1"; }, 50);
                    }, loaded * 30 + 100);
                    loaded++;
                  }
                  loadNextImage(index + 1);
                };
                img.onerror = () => { loadNextImage(index + 1); };
              }
              loadNextImage(0);
            }
          });
        return;
      }
      // If we have fewer than totalCells, fill with global minis
      fetch('/api/listminis?folder=')
        .then(res => res.json())
        .then(rootMinis => {
          let fillMinis = miniImages;
          if (Array.isArray(rootMinis) && rootMinis.length > 0 && miniImages.length < totalCells) {
            fillMinis = fillWithMinis(miniImages, rootMinis, totalCells);
          }
          const shuffled = fillMinis.slice().sort(() => Math.random() - 0.5);
          let loaded = 0;
          function loadNextMini(index) {
            if (loaded >= totalCells || index >= shuffled.length) return;
            const position = positions[loaded];
            const img = new Image();
            img.src = `/content/${shuffled[index]}`;
            img.onload = () => {
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                const cell = document.createElement("div");
                cell.className = "underlayer-cell";
                cell.style.gridColumn = position.col;
                cell.style.gridRow = position.row;
                cell.style.backgroundColor = `rgba(${Math.floor(Math.random() * 70) + 120}, ${Math.floor(Math.random() * 30) + 170}, ${Math.floor(Math.random() * 30) + 170}, ${Math.random() * 0.5 + 0.3})`;
                cell.style.opacity = "0";
                cell.style.transition = "opacity 10ms";
                if (underlayer) underlayer.appendChild(cell);
                setTimeout(() => { cell.style.opacity = "1"; }, loaded * 30);
                setTimeout(() => {
                  const gridItem = document.createElement("div");
                  gridItem.className = "grid-item";
                  gridItem.style.gridColumn = position.col;
                  gridItem.style.gridRow = position.row;
                  gridItem.style.opacity = "0";
                  gridItem.style.transition = "opacity 600ms";
                  gridItem.appendChild(img);
                  freewall.appendChild(gridItem);
                  setTimeout(() => { gridItem.style.opacity = "1"; }, 50);
                }, loaded * 30 + 100);
                loaded++;
              }
              loadNextMini(index + 1);
            };
            img.onerror = () => { loadNextMini(index + 1); };
          }
          loadNextMini(0);
        });
    })
    .catch(() => {
      // On error, fallback to background images
      const imageFolder = "assets/background/";
      const indexes = Array.from({ length: 542 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
      let loaded = 0;
      function loadNextImage(index) {
        if (loaded >= totalCells || index >= indexes.length) return;
        const position = positions[loaded];
        const img = new Image();
        img.src = `${imageFolder}image (${indexes[index]}).jpg`;
        img.onload = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            const cell = document.createElement("div");
            cell.className = "underlayer-cell";
            cell.style.gridColumn = position.col;
            cell.style.gridRow = position.row;
            cell.style.backgroundColor = `rgba(${Math.floor(Math.random() * 70) + 120}, ${Math.floor(Math.random() * 30) + 170}, ${Math.floor(Math.random() * 30) + 170}, ${Math.random() * 0.5 + 0.3})`;
            cell.style.opacity = "0";
            cell.style.transition = "opacity 10ms";
            if (underlayer) underlayer.appendChild(cell);
            setTimeout(() => { cell.style.opacity = "1"; }, loaded * 30);
            setTimeout(() => {
              const gridItem = document.createElement("div");
              gridItem.className = "grid-item";
              gridItem.style.gridColumn = position.col;
              gridItem.style.gridRow = position.row;
              gridItem.style.opacity = "0";
              gridItem.style.transition = "opacity 600ms";
              gridItem.appendChild(img);
              freewall.appendChild(gridItem);
              setTimeout(() => { gridItem.style.opacity = "1"; }, 50);
            }, loaded * 30 + 100);
            loaded++;
          }
          loadNextImage(index + 1);
        };
        img.onerror = () => { loadNextImage(index + 1); };
      }
      loadNextImage(0);
    });
}

function loadExpositionContent(folderPath, expositionNode) {
  setListOrExpositionUI(true, true);
  const contentBox = document.querySelector('.content_box');
  if (contentBox) contentBox.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
  // Ensure .test exists
  let contentTarget = contentBox ? contentBox.querySelector('.test') : null;
  if (!contentTarget && contentBox) {
    contentTarget = document.createElement('div');
    contentTarget.className = 'test';
    contentBox.appendChild(contentTarget);
  }
  const blueHue = document.getElementById('blue_hue');
  const underlayer = document.getElementById('underlayer');
  const freewall = document.getElementById('freewall');
  if (blueHue) blueHue.style.display = 'none';
  if (underlayer) underlayer.style.display = 'none';
  if (freewall) freewall.innerHTML = '';
  if (contentTarget) contentTarget.innerHTML = '';
  if (!expositionNode || !expositionNode.children) return;

  // Prevent double loading: use a flag
  if (contentTarget._expositionLoading) return;
  contentTarget._expositionLoading = true;

  const sortedSubs = [...expositionNode.children].sort((a, b) => {
    const getYear = name => {
      const match = name.match(/\(([^)]+)\)/);
      if (match) {
        const yearPart = match[1].split('-')[0];
        const yearNum = parseInt(yearPart, 10);
        return isNaN(yearNum) ? 0 : yearNum;
      }
      return 0;
    };
    return getYear(b.name) - getYear(a.name);
  });
  const imgElements = [];
  let subCount = sortedSubs.length;
  let loadedCount = 0;
  sortedSubs.forEach(sub => {
    const title = document.createElement('h3');
    const subFolderPath = folderPath + '/Exposition/' + sub.name;
    fetch(`/api/listfiles?folder=${encodeURIComponent(subFolderPath)}`)
      .then(res => res.json())
      .then(files => {
        const titreFile = files.find(f => f === 'Titre.txt');
        if (titreFile) {
          fetch(`/content/${encodeFolderPath(subFolderPath)}/Titre.txt`)
            .then(r => r.text())
            .then(txt => {
              title.textContent = txt.trim() || sub.name;
            })
            .catch(() => {
              title.textContent = sub.name;
            });
        } else {
          title.textContent = sub.name;
        }
        contentTarget.appendChild(title);
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.flexWrap = 'wrap';
        row.style.gap = '1rem';
        files.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f)).forEach(img => {
          const imgElem = document.createElement('img');
          const encodedSubName = encodeURIComponent(sub.name);
          const encodedImg = encodeURIComponent(img);
          // Use thumbnail from /mini/ subfolder for expo mode
          imgElem.src = `/content/${folderPath}/Exposition/${encodedSubName}/mini/${encodedImg}`;
          imgElem.style.maxWidth = '200px';
          imgElem.style.maxHeight = '150px';
          imgElem.style.objectFit = 'contain';
          imgElem.style.cursor = 'pointer';
          imgElem.setAttribute('data-expoimg', img);
          imgElem.setAttribute('data-exposubfolder', sub.name);
          row.appendChild(imgElem);
          imgElements.push(imgElem);
        });
        contentTarget.appendChild(row);
        loadedCount++;
        if (loadedCount === subCount) {
          // All subfolders loaded, bind overlay clicks and clear flag
          setTimeout(() => {
            bindImageOverlayClicks('img[data-expoimg]', 'expoimg');
            contentTarget._expositionLoading = false;
          }, 0);
        }
      });
  });
}

// ==========================
// Entry Point
// ==========================

function nameIntro() {
  const letters1 = document.querySelectorAll('.name h4');
  const letters2 = document.querySelectorAll('.name2 p');

  letters1.forEach((letter, index) => {
    setTimeout(() => {
      letter.classList.add('fade-in');
    }, index * 50);
  });

  letters2.forEach((letter, index) => {
    setTimeout(() => {
      letter.classList.add('fade-in');
    }, (letters1.length + index) * 50);
  });
}
nameIntro();

window.addEventListener('DOMContentLoaded', () => {
  // If there is no hash or the hash is just '#', treat as root (no forced hash set)
  if (!window.location.hash || window.location.hash === '#') {
    renderRootNavMenu();
    window._hasLoadedOnce = true;
    return;
  }
  // No need to push to hashHistory here, handled in hashchange
  loadFromHash();
  setTimeout(() => {
    if (/\/List\//.test(decodeURIComponent(window.location.hash))) {
      showProjectList();
      slideInNavList('List');
      updateProjectListActive();
    }
  }, 0);
});
window.addEventListener('hashchange', () => {
  handleOverlayFromHash('img');
  handleOverlayFromHash('expoimg');
  loadFromHash();
  // If hash points to a List subfolder, ensure project list is shown and slid in
  setTimeout(() => {
    if (/\/List\//.test(decodeURIComponent(window.location.hash))) {
      showProjectList();
      slideInNavList('List');
      updateProjectListActive();
    }
  }, 0);
});

// ==========================
// Content HTML Creator
// ==========================

function createContentHTML(images, textFile, encodedPath, mode = "list") {
    if (mode === "list") {
      // If no text file, hide the .project-docs-text div
      const textDisplay = textFile ? '' : 'display:none;';
      return `
        <div class="project-docs-container">
          <div class="project-docs-images swiper">
            <div class="swiper-wrapper">
              ${images.map(f => `
                <div class="swiper-slide">
                  <img src="/content/${encodedPath}/${encodeURIComponent(f)}" data-img="${f}" class="project-docs-image" style="cursor:pointer;" />
                </div>`).join('')}
            </div>
            <div class="swiper-button-next"></div>
            <div class="swiper-button-prev"></div>
          </div>
          <div class="project-docs-text" style="${textDisplay}">
            <div class="project-docs-pagination"></div>
            <div class="project-docs-txtcontent">${textFile ? 'Loading…' : ''}</div>
          </div>
        </div>`;
    } else {
    let html = `<div class="project-docs-container" style="display:flex;flex-direction:column;height:100%;width:100%;">`;
    if (images.length) {
      html += `<div class="project-docs-images" style="flex:2 1 0;display:flex;align-items:center;justify-content:center;gap:2rem;overflow:auto;">` +
              images.map(f => `<img src="/content/${encodedPath}/${encodeURIComponent(f)}" style="max-height:100%;max-width:100%;object-fit:contain;" />`).join('') +
              `</div>`;
    }
    if (textFile) {
      html += `<div class="project-docs-text" style="flex:1 1 0;overflow:auto;padding:2rem;background:rgba(255,255,255,0.95);">Loading…</div>`;
    }
    html += `</div>`;
    return html;
  }
}

// ==========================
// Image Overlay Click Binding
// ==========================


function bindImageOverlayClicks(selector, overlayType) {
  document.querySelectorAll(selector).forEach(img => {
    // Remove previous click listeners to avoid stacking
    img.replaceWith(img.cloneNode(true));
  });
  document.querySelectorAll(selector).forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation();
      const file = img.getAttribute('data-img') || img.getAttribute('data-expoimg');
      if (!file) return;
      // For expoimg, get subfolder if present
      let subfolder = null;
      if (overlayType === 'expoimg') {
        subfolder = img.getAttribute('data-exposubfolder');
        if (!subfolder) {
          let parent = img.parentElement;
          while (parent && parent !== document.body) {
            const prev = parent.previousElementSibling;
            if (prev && prev.tagName === 'H3') {
              subfolder = prev.textContent;
              break;
            }
            parent = parent.parentElement;
          }
        }
        if (subfolder) {
          img.setAttribute('data-exposubfolder', subfolder);
        }
      }
      // Instead of updating the hash, show the overlay directly
      showOverlayDirect(overlayType, file, subfolder);
    });
  });
}

// Show overlay directly without hash change, with Swiper for expoimg
function showOverlayDirect(type, file, subfolder) {
  const className = type === 'img' ? 'img-overlay' : (type === 'expoimg' ? 'expo-img-overlay' : `${type}-overlay`);
  const overlay = createOrGetOverlay(type, className);
  let folderPath = window.location.hash.replace(/^#/, '').replace(/\/(img|expoimg):[^/]+$/, '');
  if (type === 'expoimg') {
    if (subfolder) {
      folderPath = folderPath.replace(/\/Exposition$/, '');
      folderPath += `/Exposition/${encodeURIComponent(subfolder)}`;
    } else if (!/\/Exposition$/.test(folderPath)) {
      folderPath += '/Exposition';
    }
    // Fetch all images in the subfolder and show Swiper
    fetch(`/api/listfiles?folder=${encodeURIComponent(folderPath)}`)
      .then(res => res.json())
      .then(files => {
        const images = files.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
        if (!images.length) return;
        overlay.innerHTML = `
          <button class="expo-overlay-close" style="position:absolute;top:24px;right:32px;z-index:10000;background:rgba(0,0,0,0.5);border:none;color:var(--light-grey);font-size:2.5rem;line-height:2.5rem;width:48px;height:48px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">
            &times;
          </button>
          <div class="expo-swiper swiper" style="display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:100vw;max-height:100vh;">
            <div class="swiper-wrapper" style="flex:1 1 auto;">
              ${images.map(f => `
                <div class="swiper-slide">
                  <img src="/content/${folderPath}/${encodeURIComponent(f)}" class="expo-overlay-img" style="max-width:90vw;max-height:80vh;object-fit:contain;display:block;margin:0 auto;user-select:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;" draggable="false" onmousedown="return false;" />
                </div>`).join('')}
            </div>
            <div class="swiper-button-next"></div>
            <div class="swiper-button-prev"></div>
            <div class="expo-swiper-pagination" style="display:flex;justify-content:center;align-items:center;margin:1.5rem auto 0 auto;width:100%;position:relative;"></div>
          </div>
        `;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        // Close overlay on click outside Swiper or on X button
        function closeOverlay() {
          overlay.style.display = 'none';
          overlay.innerHTML = '';
          document.body.style.overflow = '';
        }
        overlay.onclick = (e) => {
          if (e.target === overlay) {
            closeOverlay();
          }
        };
        const closeBtn = overlay.querySelector('.expo-overlay-close');
        if (closeBtn) {
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeOverlay();
          };
        }
        // Wait for DOM, then init Swiper
        setTimeout(() => {
          if (window.Swiper) {
            const initialIndex = images.findIndex(f => f === file);
            new Swiper('.expo-swiper', {
              spaceBetween: 10,
              navigation: {
                nextEl: '.swiper-button-next',
                prevEl: '.swiper-button-prev'
              },
              slidesPerView: 1,
              effect: 'fade',
              fadeEffect: { crossFade: true },
              loop: true,
              initialSlide: initialIndex >= 0 ? initialIndex : 0,
              autoplay: false,
              pagination: {
                el: '.expo-swiper-pagination',
                clickable: true,
                renderBullet: (i, className) => {
                  // Use thumbnail for bullet, ensure correct encoding and no double slashes
                  let safeFolder = folderPath.replace(/\/+/g, '/').replace(/(^\/|\/$)/g, '');
                  let safeFile = images[i];
                  // Remove any leading slashes from file
                  safeFile = safeFile.replace(/^\/+/,'');
                  // Always encode file name
                  const encodedFile = encodeURIComponent(safeFile);
                  // Compose the URL
                  const url = `/content/${safeFolder ? safeFolder + '/' : ''}mini/${encodedFile}`;
                  // Escape apostrophes for CSS url('') context
                  const cssUrl = url.replace(/'/g, "%27");
                  return `<span class="${className}" style="background-image:url('${cssUrl}');width:40px;height:30px;background-size:cover;background-position:center;"></span>`;
                }
              }
            });
          }
        }, 0);
      });
    return;
  }
  // Default: single image overlay (for 'img' type)
  overlay.innerHTML = '';
  const img = document.createElement('img');
  img.src = `/content/${folderPath}/${encodeURIComponent(file)}`;
  img.className = className === 'img-overlay' ? 'overlay-img' : (className === 'expo-img-overlay' ? 'expo-overlay-img' : 'overlay-img');
  overlay.appendChild(img);
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
      document.body.style.overflow = '';
    }
  };
}