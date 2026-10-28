
const $ = id => document.getElementById(id);

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "svg",
  "glb", "gltf", "obj", "mtl", "fbx",
  "wav", "mp3", "ogg", "mp4", "webm",
  "json", "txt", "hdr", "exr", "ttf", "otf",
  "css", "js", "zip"
]);

const IMAGE_TYPES = new Set([
  "png", "jpg", "jpeg", "webp", "gif"
]);

const formatSize = bytes =>
  bytes < 1048576
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;

const extensionOf = name =>
  String(name).split(".").pop().toLowerCase();

function element(tag, className = "", text = undefined) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

function safeUrl(value) {
  try {
    const url = new URL(value, location.href);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function safeFilename(name) {
  return String(name || "public-asset")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 100) || "public-asset";
}

function cleanMetadata(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value?.value || "");

  return (node.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeCard({
  title,
  description,
  thumbnail,
  url,
  source,
  author,
  license,
  buttons = []
}) {
  const root = element("article", "community-card");

  if (thumbnail && safeUrl(thumbnail)) {
    const image = element("img");

    image.loading = "lazy";
    image.alt = `Preview for ${title || "public asset"}`;
    image.src = safeUrl(thumbnail);
    image.onerror = () => image.remove();

    root.append(image);
  }

  root.append(
    element("strong", "", title || "Untitled asset")
  );

  if (description) {
    root.append(element("p", "", description));
  }

  const owner = [source, author, license]
    .filter(Boolean)
    .join(" · ");

  if (owner) {
    root.append(element("div", "asset-owner", owner));
  }

  const sourceUrl = safeUrl(url);

  if (sourceUrl) {
    const link = element("a", "", "View source ↗");

    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    root.append(link);
  }

  if (buttons.length) {
    const actions = element("div", "actions");

    for (const button of buttons) {
      actions.append(button);
    }

    root.append(actions);
  }

  return root;
}

export function setupCommunity({
  getProject,
  markDirty,
  openFile,
  createFile,
  log
}) {
  let publicResults = [];
  let searchController = null;

  function status(message) {
    const node = $("communityStatus");
    if (node) node.textContent = message;
  }

  function report(message, level = "info") {
    if (typeof log === "function") {
      log(message, level);
    }
  }

  // Import files into the current local project.
  async function importIntoProject(files) {
    const project = getProject();

    if (!project) {
      throw new Error("No project is currently open.");
    }

    if (!Array.isArray(project.assets)) {
      project.assets = [];
    }

    let imported = 0;

    for (const file of files) {
      if (!file) continue;

      const extension = extensionOf(file.name);

      if (!ALLOWED_TYPES.has(extension)) {
        report(`Skipped unsupported file: ${file.name}`, "warn");
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        report(
          `Skipped ${file.name}: the maximum file size is 20 MB.`,
          "warn"
        );
        continue;
      }

      if (project.assets.some(asset => asset.name === file.name)) {
        report(`Skipped duplicate asset: ${file.name}`, "warn");
        continue;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => {
          reject(new Error(`Could not read ${file.name}.`));
        };

        reader.readAsDataURL(file);
      });

      project.assets.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl
      });

      imported++;
      report(`Imported asset: ${file.name}`, "ok");
    }

    if (imported > 0) {
      markDirty();
      renderDock();
    }

    return imported;
  }

  // Download a public asset. Wikimedia image URLs may fail
  // cross-origin browser requests, so try an image proxy as fallback.
  async function downloadPublicAsset(item) {
    const downloadUrl = safeUrl(item.download);

    if (!downloadUrl) {
      throw new Error("This asset has an invalid download URL.");
    }

    let directError;

    try {
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error("The downloaded file was empty.");
      }

      return blob;
    } catch (error) {
      directError = error;
    }

    // Only proxy common image formats. Do not send arbitrary files
    // through a third-party proxy.
    if (!IMAGE_TYPES.has(item.extension)) {
      throw new Error(
        "The source blocked direct downloading. Open View source, " +
        "download the file, then use Import local files."
      );
    }

    let source;

    try {
      source = new URL(downloadUrl);
    } catch {
      throw directError;
    }

    if (source.hostname !== "upload.wikimedia.org") {
      throw new Error(
        "Direct download failed. Use View source or import the file locally."
      );
    }

    const proxyUrl = new URL("https://images.weserv.nl/");
    proxyUrl.searchParams.set(
      "url",
      source.host + source.pathname + source.search
    );

    let proxyResponse;

    try {
      proxyResponse = await fetch(proxyUrl.href);
    } catch {
      throw new Error(
        "The image download was blocked by the browser or network. " +
        "Open View source, download the image, then use Import local files."
      );
    }

    if (!proxyResponse.ok) {
      throw new Error(
        `Image fallback failed (HTTP ${proxyResponse.status}). ` +
        "Try downloading it from View source."
      );
    }

    const blob = await proxyResponse.blob();

    if (blob.size === 0) {
      throw new Error("The image download returned an empty file.");
    }

    return blob;
  }

  function renderPublic() {
    const root = $("assetGrid");
    if (!root) return;

    root.replaceChildren();

    if (!publicResults.length) {
      root.append(
        element(
          "p",
          "empty",
          "Search Wikimedia Commons to find public assets."
        )
      );
      return;
    }

    for (const item of publicResults) {
      const importButton = element(
        "button",
        "",
        "Import to project"
      );

      importButton.type = "button";

      importButton.addEventListener("click", async () => {
        importButton.disabled = true;
        importButton.textContent = "Loading…";
        status(`Downloading ${item.title}…`);

        try {
          const blob = await downloadPublicAsset(item);

          if (blob.size > MAX_FILE_SIZE) {
            throw new Error("This asset exceeds the 20 MB import limit.");
          }

          const filename =
            `${safeFilename(item.title)}.${item.extension || "bin"}`;

          const file = new File(
            [blob],
            filename,
            {
              type: blob.type || item.mime ||
                "application/octet-stream"
            }
          );

          const imported = await importIntoProject([file]);

          if (imported > 0) {
            status(`Imported "${filename}" into your project.`);
          } else {
            status(
              "Nothing was imported. The file may already exist " +
              "or may not be supported."
            );
          }
        } catch (error) {
          const message = error?.message || "Unknown download error.";

          status(`Could not import this asset: ${message}`);
          report(`Public asset import failed: ${message}`, "warn");
        } finally {
          importButton.disabled = false;
          importButton.textContent = "Import to project";
        }
      });

      root.append(
        makeCard({
          ...item,
          buttons: [importButton]
        })
      );
    }
  }

  async function searchPublic() {
    const input = $("assetSearch");
    const button = $("communitySearch");

    if (!input || !button) return;

    const query = input.value.trim();

    if (!query) {
      status("Enter a search term first.");
      input.focus();
      return;
    }

    // Cancel an older search if the user starts a new one.
    if (searchController) {
      searchController.abort();
    }

    searchController = new AbortController();

    const currentController = searchController;

    button.disabled = true;
    button.textContent = "Searching…";

    publicResults = [];
    renderPublic();
    status("Searching Wikimedia Commons…");

    try {
      const url = new URL(
        "https://commons.wikimedia.org/w/api.php"
      );

      url.search = new URLSearchParams({
        action: "query",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: "6",
        gsrlimit: "24",
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: "360",
        format: "json",
        origin: "*"
      }).toString();

      const response = await fetch(url.href, {
        signal: currentController.signal
      });

      if (!response.ok) {
        throw new Error(`Wikimedia returned HTTP ${response.status}.`);
      }

      const data = await response.json();
      const pages = Object.values(data.query?.pages || {});

      publicResults = pages
        .map(page => {
          const info = page.imageinfo?.[0] || {};
          const metadata = info.extmetadata || {};

          const title = (page.title || "Public asset")
            .replace(/^File:/, "");

          const mime = info.mime || "";

          const extension = title.includes(".")
            ? title.split(".").pop().toLowerCase()
            : (mime.split("/")[1] || "bin")
                .replace("jpeg", "jpg");

          return {
            title,
            description:
              cleanMetadata(metadata.ImageDescription) ||
              "Public media from Wikimedia Commons.",
            thumbnail: info.thumburl || info.url || "",
            url: info.descriptionurl || info.url || "",
            download: info.url || "",
            source: "Wikimedia Commons",
            author: cleanMetadata(metadata.Artist),
            license:
              cleanMetadata(metadata.LicenseShortName) ||
              "Check the source license",
            extension,
            mime
          };
        })
        .filter(item =>
          item.download &&
          safeUrl(item.download) &&
          ALLOWED_TYPES.has(item.extension)
        );

      // Ignore results from a search that is no longer current.
      if (searchController !== currentController) return;

      renderPublic();

      if (publicResults.length) {
        status(
          `${publicResults.length} compatible result(s) found. ` +
          "Import downloads supported files into your local project. " +
          "Check each asset's license before using it."
        );
      } else {
        status(
          "No compatible files found. Try another search term."
        );
      }
    } catch (error) {
      if (error.name === "AbortError") return;

      status(`Search failed: ${error.message}`);
      report(`Community search failed: ${error.message}`, "warn");
    } finally {
      if (searchController === currentController) {
        searchController = null;
        button.disabled = false;
        button.textContent = "Search assets";
      }
    }
  }

  // Open the device's file picker for local asset imports.
  function chooseFiles(multiple = true) {
    const input = element("input");

    input.type = "file";
    input.multiple = multiple;
    input.accept = [...ALLOWED_TYPES]
      .map(extension => `.${extension}`)
      .join(",");

    input.addEventListener("change", async () => {
      try {
        const files = [...(input.files || [])];
        const imported = await importIntoProject(files);

        status(
          imported
            ? `Imported ${imported} local file(s).`
            : "No new files were imported."
        );
      } catch (error) {
        status(`Local import failed: ${error.message}`);
        report(error.message, "error");
      }
    });

    input.click();
  }

  // Render the existing project files and imported assets dock.
  function renderDock() {
    const project = getProject();
    const filesRoot = $("projectDockFiles");
    const assetsRoot = $("projectDockAssets");

    if (!project || !filesRoot || !assetsRoot) return;

    filesRoot.replaceChildren();
    assetsRoot.replaceChildren();

    const search = ($("dockSearch")?.value || "").toLowerCase();

    filesRoot.append(
      element("div", "dock-section-title", "PROJECT FILES")
    );

    const files = Object.keys(project.files || {})
      .sort()
      .filter(path => path.toLowerCase().includes(search));

    for (const path of files) {
      const row = element("div", "project-file");

      row.append(
        element("span", "t", "▤"),
        element("span", "n", path)
      );

      row.title = `Open ${path}`;
      row.addEventListener("click", () => openFile(path));

      filesRoot.append(row);
    }

    assetsRoot.append(
      element("div", "dock-section-title", "IMPORTED ASSETS")
    );

    const assets = (project.assets || [])
      .filter(asset =>
        String(asset.name).toLowerCase().includes(search)
      );

    if (!assets.length) {
      assetsRoot.append(
        element("div", "empty", "No imported assets.")
      );
    }

    for (const asset of assets) {
      const row = element("div", "project-file");

      row.append(
        element("span", "t", "◇"),
        element(
          "span",
          "n",
          `${asset.name} · ${formatSize(asset.size || 0)}`
        )
      );

      const removeButton = element("button", "", "×");

      removeButton.type = "button";
      removeButton.title = "Remove imported asset";

      removeButton.addEventListener("click", event => {
        event.stopPropagation();

        if (!confirm(`Remove "${asset.name}" from this project?`)) {
          return;
        }

        project.assets = project.assets.filter(
          item => item.id !== asset.id
        );

        markDirty();
        renderDock();

        report(`Removed asset: ${asset.name}`);
      });

      row.append(removeButton);
      assetsRoot.append(row);
    }
  }

  // Wire up the existing Community and project dock controls.
  $("assetSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPublic();
    }
  });

  $("communitySearch")?.addEventListener("click", event => {
    event.preventDefault();
    searchPublic();
  });

  $("communitySearchForm")?.addEventListener("submit", event => {
    event.preventDefault();
    searchPublic();
  });

  $("importAsset")?.addEventListener("click", () => {
    chooseFiles(true);
  });

  $("dockImport")?.addEventListener("click", () => {
    chooseFiles(true);
  });

  $("dockSearch")?.addEventListener("input", renderDock);

  $("dockNew")?.addEventListener("click", () => {
    if (typeof createFile === "function") createFile();
  });

  document.querySelectorAll("[data-bottom]").forEach(button => {
    button.addEventListener("click", () => {
      const filesVisible = button.dataset.bottom === "files";

      const logPanel = $("log");
      const consoleTools = $("consoleTools");
      const dock = $("projectDock");

      if (logPanel) logPanel.hidden = filesVisible;
      if (consoleTools) consoleTools.hidden = filesVisible;
      if (dock) dock.hidden = !filesVisible;

      document.querySelectorAll("[data-bottom]").forEach(item => {
        item.classList.toggle("on", item === button);
      });

      if (filesVisible) renderDock();
    });
  });

  renderPublic();

  return {
    renderDock,
    importAssets: () => chooseFiles(true),
    searchPublic
  };
}
