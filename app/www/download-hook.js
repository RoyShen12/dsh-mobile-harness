/* Download hook injected into every remote page by the Android shell.
 *
 * Android WebView silently ignores <a download> clicks (no DownloadListener), which is why
 * tapping 下载 in the Life Helper page did nothing. Instead of handing the URL to the system
 * downloader — it would miss the HttpOnly gateway session cookie — we fetch the file with the
 * page's own cookies and stream it into the app in base64 chunks, where the shell writes it to
 * the phone's Download/DSH folder and records it in the in-app download history.
 */
(function () {
  if (window.__dshDownloadHook) return;
  window.__dshDownloadHook = true;

  var bridge = window.DshApp || null;

  function base64(bytes) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var comma = text.indexOf(',');
        resolve(comma >= 0 ? text.slice(comma + 1) : '');
      };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsDataURL(new Blob([bytes]));
    });
  }

  function nameFromUrl(url) {
    var path = String(url).split('#')[0].split('?')[0];
    var last = path.substring(path.lastIndexOf('/') + 1);
    try { last = decodeURIComponent(last); } catch (e) { /* keep raw */ }
    return last || 'download.bin';
  }

  function nameFromDisposition(header) {
    if (!header) return '';
    var utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (utf8) { try { return decodeURIComponent(utf8[1].trim()); } catch (e) { return utf8[1].trim(); } }
    var plain = /filename="?([^";]+)"?/i.exec(header);
    return plain ? plain[1].trim() : '';
  }

  window.__dshFetchDownload = async function (url, fallbackName) {
    if (!bridge || typeof bridge.beginDownload !== 'function') {
      if (bridge && bridge.nativeDownload) bridge.nativeDownload(url, fallbackName || '');
      return;
    }
    var response;
    try {
      response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    } catch (error) {
      bridge.downloadError('网络错误：' + (error && error.message ? error.message : error));
      return;
    }
    if (!response.ok) {
      bridge.downloadError('下载失败（HTTP ' + response.status + '）');
      return;
    }
    var name = nameFromDisposition(response.headers.get('content-disposition')) || fallbackName || nameFromUrl(url);
    var mime = response.headers.get('content-type') || 'application/octet-stream';
    var total = Number(response.headers.get('content-length') || 0);
    var id = bridge.beginDownload(name, mime, total);
    if (!id) {
      bridge.downloadError('无法在手机上创建文件');
      return;
    }
    try {
      if (response.body && typeof response.body.getReader === 'function') {
        var reader = response.body.getReader();
        while (true) {
          var step = await reader.read();
          if (step.done) break;
          bridge.appendDownload(id, await base64(step.value));
        }
      } else {
        bridge.appendDownload(id, await base64(new Uint8Array(await response.arrayBuffer())));
      }
      bridge.finishDownload(id);
    } catch (error) {
      bridge.abortDownload(id);
      bridge.downloadError('下载中断：' + (error && error.message ? error.message : error));
    }
  };

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.tagName !== 'A') node = node.parentElement;
    if (!node) return;
    var href = node.href || '';
    var hasDownload = node.hasAttribute('download');
    var looksLikeFile = href.indexOf('/api/life-helper.file') >= 0;
    if (!hasDownload && !looksLikeFile) return;
    if (!/^https?:/i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    window.__dshFetchDownload(href, node.getAttribute('download') || '');
  }, true);

  /* 「下载记录」 lives in file transfer, not in a pill floating over every page.
   *
   * The life-helper 文件池 card renders <span data-dsh-dl-mount> in its toolbar; we mount a
   * normal toolbar button there, and drop it again when that card is not on screen (another DSH
   * panel, the config page, ...). Older hosts without the mount point fall back to the toolbar of
   * the 文件池 section so the entry does not disappear before the plugin is restarted. */
  var BTN_ID = 'dsh-dl-entry';

  function mountPoint() {
    var slot = document.querySelector('[data-dsh-dl-mount]');
    if (slot) return slot;
    var heads = document.querySelectorAll('.dlh-section-head');
    for (var i = 0; i < heads.length; i++) {
      var title = heads[i].querySelector('h2');
      if (!title || String(title.textContent || '').indexOf('文件池') !== 0) continue;
      var toolbar = heads[i].querySelector('.dlh-toolbar');
      if (toolbar) return toolbar;
    }
    return null;
  }

  function ensureEntry() {
    if (!bridge || typeof bridge.showDownloads !== 'function') return;
    var target = mountPoint();
    var existing = document.getElementById(BTN_ID);
    if (!target) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.parentElement === target) return;
    if (existing) existing.remove();
    var button = document.createElement('button');
    button.id = BTN_ID;
    button.type = 'button';
    button.textContent = '下载记录';
    button.setAttribute('class', 'dlh-btn');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (bridge && bridge.showDownloads) bridge.showDownloads();
    });
    target.appendChild(button);
  }

  ensureEntry();
  setInterval(ensureEntry, 1500);
})();
