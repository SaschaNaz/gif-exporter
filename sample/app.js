document.addEventListener("DOMContentLoaded", () => {
  decodeButton.addEventListener("change", () => {
    if (decodeButton.files.length === 0) {
      return;
    }
    clearMessage();
    lockButtons();
    stackMessage("Decoding...");
    const jszip = new JSZip();
    const file = decodeButton.files[0];
    GIFExporter.get(file)
        .then(result => {
            stackMessage(`Decoded: width=${result.width} px, height=${result.height} px, duration=${result.duration}`);
            const nameSplit = splitFileName(file.name);

            downloaderButton.disabled = false;
            const promises = [];
            for (let i = 0; i < result.frames.length; i++) {
                promises.push(jszip.file(`${nameSplit.displayName}.frame${i}.png`, result.frames[i].blob))
            }
            return Promise.all(promises);
        })
        .then(() => jszip.generateAsync({ type: "blob" }))
        .then(result => {
            downloader.download = `${file.name}.zip`;
            downloader.href = URL.createObjectURL(result, { oneTimeOnly: true });
        })
        .catch(err => {
            stackMessage(`Decode failed: ${err.message}`);
            console.error(err);
        })
        .then(unlockButtons, unlockButtons);
  });
})

function clearMessage() {
  message.textContent = "";
}

function splitFileName(filename) {
  const splitted = filename.split('.');
  const extension = splitted.pop();
  const displayName = splitted.join('.');
  return { displayName, extension }
}

function stackMessage(text) {
  const p = document.createElement("p");
  p.textContent = text;
  message.appendChild(p);
}

function lockButtons() {
    decodeButton.disabled = true;
}

function unlockButtons() {
    decodeButton.disabled = false;
}