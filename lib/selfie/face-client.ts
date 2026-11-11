/**
 * Face signature, computed ON THE PHONE with an open-source model (face-api, MIT; model files in /public/models, nothing is sent to a third party).
 * Only 128 numbers leave the phone, never a face template image; the server compares them with the other photos to catch the same person
 * being submitted for several accounts. The library and the 6.8 MB of model files load only when the camera opens, then stay in the browser cache.
 */
type FaceApi = typeof import('@vladmandic/face-api');
let loading: Promise<FaceApi> | null = null;

export function preloadFace(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = (await import('@vladmandic/face-api/dist/face-api.esm.js')) as unknown as FaceApi;
      const tf = (faceapi as any).tf;   // the bundled TensorFlow.js (its typings are partial)
      try { await tf.setBackend('webgl'); } catch { /* falls back below */ }
      if (tf.getBackend() !== 'webgl') await tf.setBackend('cpu');
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      return faceapi;
    })();
    loading.catch(() => { loading = null; });   // allow a retry after a failed download
  }
  return loading;
}

/** The biggest face in the picture as 128 numbers, how many faces were seen, or null when nothing could be computed (never throws). */
export async function faceSignature(src: HTMLImageElement | HTMLCanvasElement, timeoutMs = 25000): Promise<{ descriptor: number[] | null; faces: number }> {
  try {
    const work = (async () => {
      const faceapi = await preloadFace();
      const all = await faceapi.detectAllFaces(src, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })).withFaceLandmarks(true).withFaceDescriptors();
      if (all.length === 0) return { descriptor: null, faces: 0 };
      all.sort((a, b) => b.detection.box.area - a.detection.box.area);
      return { descriptor: Array.from(all[0].descriptor), faces: all.length };
    })();
    return await Promise.race([work, new Promise<{ descriptor: null; faces: number }>((res) => setTimeout(() => res({ descriptor: null, faces: -1 }), timeoutMs))]);
  } catch {
    return { descriptor: null, faces: -1 };
  }
}
