let file;
let chunkSize;

addEventListener('message', async (event) => {
  if (typeof event.data == 'number') {
    const newSegment = [[], [], [], [], [], [], [], []];
    const promises = [];
    const l = event.data;
    const segments = file.length / chunkSize;
    const length =
      Math.min(
        l + 1 > segments ? file.length % chunkSize : file.length,
        chunkSize
      ) / 8;
    for (let k = 0; k < length; k++)
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
    postMessage([l, newSegment]);
  } else {
    file = event.data[0];
    chunkSize = event.data[1];
  }
});
