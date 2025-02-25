const inputSplit = document.querySelectorAll('input[type=file]')[0];
const inputJoin = document.querySelectorAll('input[type=file]')[1];
const params = document.querySelectorAll('input[type=text]');
const fileDisplay = document.getElementById('fileDisplay');

// Download all files, if multiple file downloads are allowed and not waiting too long.
fileDisplay.firstElementChild.addEventListener('click', () => {
  [...fileDisplay.children].slice(1).forEach((a) => {
    fileDisplay.children.length > 8 &&
      alert(
        'Many files are being downloaded at once. This alert prevents later downloads from hanging and being canceled.'
      );
    a.click();
  });
});

// Split one file into several, output size in chunks of up to 8 MB.
inputSplit.addEventListener('input', async () => {
  const fileName = inputSplit.files[0].name;
  const file = new Uint8Array(await inputSplit.files[0].arrayBuffer());

  // Greatly exceeding 8 MB may create too many simultaneous promises, causing a crash.
  const chunkSize = Math.min(params[0].value, 8e6);
  const segments = file.length / chunkSize;

  // Add a file containing necessary metadata (e.g., MIME type).
  let newFile = [
    new File(
      [JSON.stringify([inputSplit.files[0].type, (8 - (file.length % 8)) % 8])],
      fileName + '_0',
      { type: 'text/plain' }
    ),
  ];

  let completedFiles = 0;
  const workers = [];
  for (let i = 0; i < navigator.hardwareConcurrency; i++) {
    const shuffleWorker = new Worker('./shuffle.js');
    shuffleWorker.addEventListener('message', (event) => {
      const l = event.data[0];
      const newSegment = event.data[1];
      // Combine 8 chunks of data to create one file, and add it to the list of files.
      newFile = newFile.concat(
        new File(
          newSegment.map((s) => new Uint8Array(s).buffer),
          // The order of the split data is preserved by indexing the file names.
          fileName + '_' + (l + 1),
          { type: '' }
        )
      );
      if (++completedFiles >= segments) {
        console.log(newFile);

        // Append all the files to the document to be displayed in a list.
        newFile.forEach((a) => {
          let file = document.createElement('a');
          file.innerText = a.name;
          file.setAttribute('download', a.name);
          fileDisplay.appendChild(file);

          // Create a one-time-use download URL whenever the file name is clicked on.
          file.addEventListener('click', () => {
            setTimeout(
              URL.revokeObjectURL,
              0,
              (file.href = URL.createObjectURL(a))
            );
          });
        });
      }
    });
    shuffleWorker.postMessage([file, chunkSize]);
    workers.push(shuffleWorker);
  }

  // Divide the file into several chunks, then rearrange the bits.
  // TODO: Add option to disable this bit rearrangement and/or use encryption instead.
  for (let l = 0; l < segments; l++) {
    if (workers.length) {
      workers[l % workers.length].postMessage(l);
    } else {
      const newSegment = [[], [], [], [], [], [], [], []];
      const promises = [];
      for (
        let k = 0,
          length =
            Math.min(
              l + 1 > segments ? file.length % chunkSize : file.length,
              chunkSize
            ) / 8;
        k < length;
        k++
      )
        // For every 8 bytes, create a promise that will later rearrange the bits.
        // Promises are used to perform this rearrangement asynchronously / in parallel.
        promises.push(
          new Promise((r) => {
            /* Rearrange the bits 8 bytes at a time. Divide each byte into 8 bits.
             * Each bit is sent to a corresponding index in the array.
             * For example, the 1st bit of each byte is sent to the 0th index.
             * The 2nd bit of each byte is sent to the 1st index, and so on.
             */
            const fileSplit = new Uint8Array(8);
            for (let h = k * 8 + l * chunkSize, j = h + 8; h < j; h++)
              for (let i = 0; i < 8; i++)
                fileSplit[i] = (fileSplit[i] << 1) | ((file[h] >> i) & 1);
            r(fileSplit);
          })
        );

      // Execute all promises in the chunk asynchronously. The total number of bytes
      // should be a multiple of 8, due to the way the bits are rearranged.
      (await Promise.all(promises)).forEach((a) => {
        for (let i = 0; i < 8; i++) newSegment[i].push(a[i]);
      });

      // Combine 8 chunks of data to create one file, and add it to the list of files.
      newFile = newFile.concat(
        new File(
          newSegment.map((s) => new Uint8Array(s).buffer),
          // The order of the split data is preserved by indexing the file names.
          fileName + '_' + (l + 1),
          { type: '' }
        )
      );
    }
  }
  if (!workers.length) {
    console.log(newFile);

    // Append all the files to the document to be displayed in a list.
    newFile.forEach((a) => {
      let file = document.createElement('a');
      file.innerText = a.name;
      file.setAttribute('download', a.name);
      fileDisplay.appendChild(file);

      // Create a one-time-use download URL whenever the file name is clicked on.
      file.addEventListener('click', () => {
        setTimeout(
          URL.revokeObjectURL,
          0,
          (file.href = URL.createObjectURL(a))
        );
      });
    });
  }
});

// Join several files that were split using this file splitter into one.
inputJoin.addEventListener('input', async () => {
  // Ensure the files are in the correct order based on the indexed file names.
  const inputFiles = [...inputJoin.files].sort(
    (a, b) =>
      a.name.replace(/[^]+?(?=\d+$)/, '') - b.name.replace(/[^]+?(?=\d+$)/, '')
  );

  // Grab the original file's metadata from the 0th file.
  // Remainder is needed to truncate extra bytes generated from rearranging the data.
  const [fileType, remainder] = JSON.parse(await inputFiles[0].text());
  let newFile = [];

  // For the rest of the files, reverse the rearrangement of the data.
  for (let f = 1; f < inputFiles.length; f++) {
    // 8 chunks are generated at a time, so divide the file into 8 segments.
    const segment = new Uint8Array(await inputFiles[f].arrayBuffer()),
      segmentLength = segment.length >> 3;
    const fileSegments = [];
    for (let i = 0; i < 8; i++)
      fileSegments.push(
        segment.subarray(i * segmentLength, (i + 1) * segmentLength)
      );

    const newSegment = [];
    const promises = [];
    for (let k = 0; k < segmentLength; k++)
      // For every byte in a chunk, create a promise to later produce the original data.
      // Promises are used to operate on these bytes asynchronously / in parallel.
      promises.push(
        new Promise((r) => {
          /* Restore the order of the bits 8 bytes at a time. To restore a byte,
           * 1 bit is taken from each of the 8 chunks in sequential order. For example,
           * the 1st bit of the 1st byte from each of the 8 chunks is taken to restore
           * the 1st original byte, then the 2nd bit of the 1st byte restores the next.
           */
          const fileSplit = new Uint8Array(8);
          for (let h = 0; h < 8; h++)
            for (let i = 0; i < 8; i++)
              // Each bit in a byte should be restored in reverse order.
              fileSplit[h] =
                (fileSplit[h] << 1) | ((fileSegments[7 - i][k] >> (7 - h)) & 1);
          r(fileSplit);
        })
      );

    // Execute all promises for a given file fragment simultaneously.
    // The total number of bytes should still be a multiple of 8.
    (await Promise.all(promises)).forEach((a) => {
      for (let i = 0; i < 8; i++) newSegment.push(a[i]);
    });

    // Use the metadata from the 0th file to cut off excess bytes in the last chunk.
    // Form the original file by putting the newly created chunks together.
    f == inputFiles.length - 1 && remainder && newSegment.splice(-remainder);
    newFile = newFile.concat(new Uint8Array(newSegment).buffer);
  }
  newFile = new File(newFile, inputFiles[0].name.replace(/_\d+$/, ''), {
    type: fileType,
  });
  console.log(newFile);

  // Append the original file to the document to be displayed in a list.
  let file = document.createElement('a');
  file.innerText = newFile.name;
  file.setAttribute('download', newFile.name);
  fileDisplay.appendChild(file);

  // Create a one-time-use download URL whenever the file name is clicked on.
  file.addEventListener('click', () => {
    setTimeout(
      URL.revokeObjectURL,
      0,
      (file.href = URL.createObjectURL(newFile))
    );
  });
});
