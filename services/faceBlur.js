const fs = require('fs');
const path = require('path');
const { uploadVideo } = require('./objectStorage');

const DEFAULT_FACE_BLUR_API_URL = 'https://unyield-faceblur-api-production.up.railway.app';

const toObject = (value) => (value && typeof value === 'object' ? value : {});

const getOriginFromUrl = (value) => {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
};

const resolveAbsoluteUrl = (value, { requestOrigin = '', sourceVideoUrl = '' } = {}) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = requestOrigin || getOriginFromUrl(sourceVideoUrl);
  if (!base) return raw;
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
};

const extractFaceBlurMetrics = (rawData) => {
  const payload = toObject(rawData);
  const nested = toObject(payload.data);
  const source = Object.keys(nested).length > 0 ? nested : payload;

  const facesDetected = Number(
    source.facesDetected
      ?? source.facesBlurred
      ?? source.facesFound
      ?? payload.facesDetected
      ?? payload.facesBlurred
      ?? payload.facesFound
      ?? 0
  ) || 0;

  const facesBlurred = Number(
    source.facesBlurred
      ?? source.facesDetected
      ?? source.facesFound
      ?? payload.facesBlurred
      ?? payload.facesDetected
      ?? payload.facesFound
      ?? 0
  ) || 0;

  const framesProcessed = Number(
    source.framesProcessed
      ?? source.totalFrames
      ?? payload.framesProcessed
      ?? payload.totalFrames
      ?? 0
  ) || 0;

  return {
    facesDetected,
    facesBlurred,
    framesProcessed,
  };
};

const resolveBlurSourceFields = (rawData) => {
  const payload = toObject(rawData);
  const nested = toObject(payload.data);
  const source = Object.keys(nested).length > 0 ? nested : payload;

  return {
    blurredVideoUrl: source.blurredVideoUrl || payload.blurredVideoUrl || '',
    originalVideoUrl: source.originalVideoUrl || payload.originalVideoUrl || '',
    blurredObjectName: source.blurredObjectName || source.objectName || payload.blurredObjectName || payload.objectName || '',
    originalObjectName: source.originalObjectName || payload.originalObjectName || '',
    outputPath: source.outputPath || payload.outputPath || '',
    privacyFallbackApplied: Boolean(source.privacyFallbackApplied || payload.privacyFallbackApplied),
    temporalPropagationApplied: Boolean(source.temporalPropagationApplied || payload.temporalPropagationApplied),
    propagatedFaces: Number(source.propagatedFaces || payload.propagatedFaces || 0) || 0,
  };
};

async function requestFaceBlur(videoUrl, timeoutMs = Number(process.env.FACE_BLUR_TIMEOUT_MS || 360000)) {
  const FACE_BLUR_API_URL = process.env.FACE_BLUR_API_URL || DEFAULT_FACE_BLUR_API_URL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${FACE_BLUR_API_URL}/blur`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Face blur service returned invalid JSON (${response.status})`);
    }

    if (!response.ok || !data?.success) {
      throw new Error(data?.error || `Face blur API returned status ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function normalizeFaceBlurResult(rawData, { sourceVideoUrl, requestOrigin = '' } = {}) {
  const fields = resolveBlurSourceFields(rawData);
  const metrics = extractFaceBlurMetrics(rawData);

  let blurredVideoUrl = resolveAbsoluteUrl(fields.blurredVideoUrl, { requestOrigin, sourceVideoUrl });
  let objectName = String(fields.blurredObjectName || '').trim() || null;

  // Local Flask face blur service returns outputPath instead of public URL.
  if (!blurredVideoUrl && fields.outputPath) {
    const localPath = path.resolve(String(fields.outputPath));
    if (!fs.existsSync(localPath)) {
      throw new Error(`Face blur output file not found: ${localPath}`);
    }

    const fileBuffer = fs.readFileSync(localPath);
    const uploadResult = await uploadVideo(fileBuffer, path.basename(localPath), 'video/mp4');
    objectName = uploadResult.objectName || objectName;
    blurredVideoUrl = resolveAbsoluteUrl(uploadResult.publicUrl, { requestOrigin, sourceVideoUrl });

    try {
      fs.unlinkSync(localPath);
    } catch {
      // Best effort cleanup only.
    }
  }

  const originalVideoUrl = resolveAbsoluteUrl(fields.originalVideoUrl || sourceVideoUrl, { requestOrigin, sourceVideoUrl })
    || String(sourceVideoUrl || '').trim();

  const fallbackToOriginal = !blurredVideoUrl;
  if (fallbackToOriginal) {
    blurredVideoUrl = originalVideoUrl;
  }

  return {
    blurredVideoUrl,
    originalVideoUrl,
    objectName,
    originalObjectName: fields.originalObjectName || null,
    facesFound: metrics.facesBlurred || metrics.facesDetected || 0,
    facesDetected: metrics.facesDetected,
    facesBlurred: metrics.facesBlurred,
    framesProcessed: metrics.framesProcessed,
    privacyFallbackApplied: fields.privacyFallbackApplied || fallbackToOriginal,
    temporalPropagationApplied: fields.temporalPropagationApplied,
    propagatedFaces: fields.propagatedFaces,
  };
}

module.exports = {
  requestFaceBlur,
  normalizeFaceBlurResult,
};
