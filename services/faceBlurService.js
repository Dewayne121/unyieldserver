/**
 * Face Blur Service
 * Uses Google Cloud Vision API to detect faces and applies blur to video frames
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const sharp = require('sharp');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Google Cloud Vision API endpoint
const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';
const GOOGLE_API_KEY = process.env.GOOGLE_API;

// Configuration
const CONFIG = {
  // Extract 1 frame per second (adjust for quality vs API cost)
  frameSampleRate: 1,
  // Blur intensity (sigma)
  blurSigma: 20,
  // Padding around face bounding box (percentage)
  facePadding: 0.2,
  // Maximum faces to detect per frame
  maxFaces: 10,
  // Request timeout (ms)
  timeout: 120000, // 2 minutes
  // Temp directory
  tempDir: '/tmp',
};

/**
 * Detect faces in an image using Google Cloud Vision API
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Array>} - Array of face bounding boxes
 */
async function detectFaces(imageBuffer) {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API environment variable not set');
  }

  // Convert image to base64
  const base64Image = imageBuffer.toString('base64');

  const requestBody = {
    requests: [
      {
        image: {
          content: base64Image,
        },
        features: [
          {
            type: 'FACE_DETECTION',
            maxResults: CONFIG.maxFaces,
          },
        ],
      },
    ],
  };

  try {
    console.log('[FACE BLUR] Calling Google Vision API...');
    const response = await axios.post(
      `${VISION_API_URL}?key=${GOOGLE_API_KEY}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout for API call
      }
    );

    const faces = response.data?.responses?.[0]?.faceAnnotations || [];
    console.log(`[FACE BLUR] Detected ${faces.length} face(s)`);

    // Extract bounding boxes
    const boundingBoxes = faces.map((face) => {
      const vertices = face.boundingPoly?.vertices || [];
      // Convert vertices to bounding box with padding
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      vertices.forEach((v) => {
        if (v.x !== undefined) minX = Math.min(minX, v.x);
        if (v.y !== undefined) minY = Math.min(minY, v.y);
        if (v.x !== undefined) maxX = Math.max(maxX, v.x);
        if (v.y !== undefined) maxY = Math.max(maxY, v.y);
      });

      // Add padding
      const width = maxX - minX;
      const height = maxY - minY;
      const paddingX = width * CONFIG.facePadding;
      const paddingY = height * CONFIG.facePadding;

      return {
        left: Math.max(0, Math.floor(minX - paddingX)),
        top: Math.max(0, Math.floor(minY - paddingY)),
        width: Math.floor(width + 2 * paddingX),
        height: Math.floor(height + 2 * paddingY),
      };
    });

    return boundingBoxes;
  } catch (error) {
    console.error('[FACE BLUR] Google Vision API error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    if (error.response?.status === 403) {
      throw new Error('Google API key invalid or quota exceeded');
    } else if (error.response?.status === 400) {
      throw new Error('Invalid image format for face detection');
    }

    // Re-throw for caller to handle
    throw error;
  }
}

/**
 * Apply blur to specified regions in an image
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Array} regions - Array of {left, top, width, height} regions to blur
 * @param {number} imageWidth - Image width (for validation)
 * @param {number} imageHeight - Image height (for validation)
 * @returns {Promise<Buffer>} - Processed image buffer
 */
async function applyBlurToRegions(imageBuffer, regions, imageWidth, imageHeight) {
  if (regions.length === 0) {
    return imageBuffer;
  }

  try {
    let image = sharp(imageBuffer);
    const metadata = await image.metadata();

    // Create a blur overlay for each face region
    // Since sharp doesn't support region-specific blur easily,
    // we'll use a different approach: extract each region, blur it, and composite back

    const composites = [];

    for (const region of regions) {
      // Validate region bounds
      if (
        region.left < 0 ||
        region.top < 0 ||
        region.left + region.width > metadata.width ||
        region.top + region.height > metadata.height
      ) {
        console.warn('[FACE BLUR] Invalid face region, skipping:', region);
        continue;
      }

      // Extract the face region
      const regionBuffer = await image
        .clone()
        .extract(region)
        .toBuffer();

      // Apply blur to the extracted region
      const blurredRegion = await sharp(regionBuffer)
        .blur(CONFIG.blurSigma)
        .toBuffer();

      // Add to composites
      composites.push({
        input: blurredRegion,
        left: region.left,
        top: region.top,
      });
    }

    if (composites.length === 0) {
      return imageBuffer;
    }

    // Composite all blurred regions onto the original image
    const result = await image
      .composite(composites)
      .toBuffer();

    return result;
  } catch (error) {
    console.error('[FACE BLUR] Error applying blur:', error);
    throw error;
  }
}

/**
 * Download video from URL to temp file
 * @param {string} url - Video URL
 * @returns {Promise<string>} - Path to downloaded file
 */
async function downloadVideo(url) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000,
  });

  const tempPath = path.join(CONFIG.tempDir, `input-${Date.now()}.mp4`);
  const writer = fs.createWriteStream(tempPath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', () => resolve(tempPath));
    writer.on('error', reject);
  });
}

/**
 * Extract frames from video at specified interval
 * @param {string} inputPath - Input video path
 * @param {string} outputDir - Output directory for frames
 * @returns {Promise<Array>} - Array of frame file paths
 */
function extractFrames(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const framePattern = path.join(outputDir, 'frame-%04d.jpg');

    ffmpeg(inputPath)
      .outputOptions([
        `-vf fps=1/${CONFIG.frameSampleRate}`, // Extract 1 frame per second
        '-q:v 2', // High quality JPEG
      ])
      .output(framePattern)
      .on('end', () => {
        // Read the generated frames
        fs.readdir(outputDir, (err, files) => {
          if (err) {
            reject(err);
            return;
          }
          const frames = files
            .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
            .sort()
            .map((f) => path.join(outputDir, f));
          resolve(frames);
        });
      })
      .on('error', reject)
      .run();
  });
}

/**
 * Re-encode video from processed frames
 * @param {string} inputPath - Original video path (for audio)
 * @param {string} framesDir - Directory containing processed frames
 * @param {string} outputPath - Output video path
 * @returns {Promise<void>}
 */
function reencodeVideo(inputPath, framesDir, outputPath) {
  return new Promise((resolve, reject) => {
    const framePattern = path.join(framesDir, 'frame-%04d.jpg');

    ffmpeg(inputPath)
      .input(framePattern)
      .inputOptions([
        '-framerate 1', // Frame rate matches extraction
      ])
      .outputOptions([
        '-c:v libx264',
        '-preset medium',
        '-crf 23',
        '-pix_fmt yuv420p',
        '-c:a aac', // Copy audio
        '-shortest', // Match shortest duration
        '-r 30', // Output at 30 fps
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Process video to blur faces
 * @param {string} videoUrl - URL of video to process
 * @returns {Promise<{buffer: Buffer, facesFound: number}>}
 */
async function blurVideoFromUrl(videoUrl) {
  console.log('[FACE BLUR] Starting video processing...');

  let inputPath = null;
  let framesDir = null;
  let outputPath = null;

  try {
    // Step 1: Download video
    console.log('[FACE BLUR] Downloading video...');
    inputPath = await downloadVideo(videoUrl);
    console.log('[FACE BLUR] Video downloaded to:', inputPath);

    // Create frames directory
    framesDir = path.join(CONFIG.tempDir, `frames-${Date.now()}`);
    fs.mkdirSync(framesDir, { recursive: true });

    // Step 2: Extract frames
    console.log('[FACE BLUR] Extracting frames...');
    const framePaths = await extractFrames(inputPath, framesDir);
    console.log(`[FACE BLUR] Extracted ${framePaths.length} frame(s)`);

    if (framePaths.length === 0) {
      throw new Error('No frames extracted from video');
    }

    // Step 3: Process each frame
    let totalFacesFound = 0;

    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      console.log(`[FACE BLUR] Processing frame ${i + 1}/${framePaths.length}...`);

      // Read frame
      const frameBuffer = fs.readFileSync(framePath);
      const metadata = await sharp(frameBuffer).metadata();

      // Detect faces
      const faces = await detectFaces(frameBuffer);
      totalFacesFound += faces.length;

      // Apply blur if faces found
      if (faces.length > 0) {
        console.log(`[FACE BLUR] Frame ${i + 1}: Found ${faces.length} face(s), applying blur...`);
        const processedBuffer = await applyBlurToRegions(
          frameBuffer,
          faces,
          metadata.width,
          metadata.height
        );

        // Save processed frame
        fs.writeFileSync(framePath, processedBuffer);
      }
    }

    console.log(`[FACE BLUR] Total faces found: ${totalFacesFound}`);

    // Step 4: Re-encode video with processed frames
    console.log('[FACE BLUR] Re-encoding video...');
    outputPath = path.join(CONFIG.tempDir, `output-${Date.now()}.mp4`);
    await reencodeVideo(inputPath, framesDir, outputPath);
    console.log('[FACE BLUR] Video re-encoded to:', outputPath);

    // Step 5: Read result and cleanup
    const resultBuffer = fs.readFileSync(outputPath);

    // Cleanup temp files
    cleanup(inputPath, framesDir, outputPath);

    console.log('[FACE BLUR] Processing complete!');
    return {
      buffer: resultBuffer,
      facesFound: totalFacesFound,
    };

  } catch (error) {
    console.error('[FACE BLUR] Processing error:', error);

    // Cleanup temp files
    cleanup(inputPath, framesDir, outputPath);

    throw error;
  }
}

/**
 * Cleanup temp files
 */
function cleanup(...paths) {
  paths.forEach((p) => {
    if (p && fs.existsSync(p)) {
      try {
        if (fs.statSync(p).isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      } catch (err) {
        console.warn('[FACE BLUR] Cleanup error:', err.message);
      }
    }
  });
}

module.exports = {
  blurVideoFromUrl,
  detectFaces,
  applyBlurToRegions,
};
