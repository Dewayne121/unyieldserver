const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/prisma');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { uploadVideo, deleteVideo } = require('../services/objectStorage');
const { blurVideoFromUrl } = require('../services/faceBlurService');

const router = express.Router();

// Ensure uploads directory exists (for backward compatibility)
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for disk storage (to avoid OOM on Render free tier)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, '/tmp'); // Use /tmp for ephemeral storage
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept video files only
    const allowedMimes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/webm',
      'video/x-msvideo',
      'video/x-ms-wmv',
    ];
    const allowedExtensions = [
      '.mp4',
      '.m4v',
      '.mov',
      '.webm',
      '.mpeg',
      '.mpg',
      '.avi',
      '.wmv',
    ];
    const extension = path.extname(file.originalname || '').toLowerCase();
    const hasAllowedExtension = allowedExtensions.includes(extension);
    const hasAllowedMime = allowedMimes.includes(file.mimetype) || (file.mimetype || '').startsWith('video/');

    if (hasAllowedMime || hasAllowedExtension) {
      cb(null, true);
    } else {
      req.fileValidationError = 'Invalid file type. Only video files are allowed.';
      cb(null, false);
    }
  }
});

// Helper to check if user can verify videos (has admin or community_support accolade)
const canVerify = (user) => {
  return user.accolades && (
    user.accolades.includes('admin') ||
    user.accolades.includes('community_support')
  );
};

// POST /api/videos/upload - Upload video file to Oracle Cloud Object Storage
router.post('/upload', authenticate, upload.single('video'), asyncHandler(async (req, res) => {
  console.log('[UPLOAD ROUTE] Upload request received');
  console.log('[UPLOAD ROUTE] User:', req.user?.id);
  console.log('[UPLOAD ROUTE] File present:', !!req.file);

  if (!req.file) {
    console.error('[UPLOAD ROUTE] No file in request');
    if (req.fileValidationError) {
      throw new AppError(req.fileValidationError, 400);
    }
    throw new AppError('No video file uploaded', 400);
  }

  try {
    console.log('[UPLOAD ROUTE] Reading file from disk...');
    const fileBuffer = fs.readFileSync(req.file.path);
    console.log('[UPLOAD ROUTE] File read from disk, size:', fileBuffer.length);

    console.log('[UPLOAD ROUTE] Calling uploadVideo service...');
    const uploadResult = await uploadVideo(
      fileBuffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Clean up temp file
    fs.unlinkSync(req.file.path);
    console.log('[UPLOAD ROUTE] Temp file cleaned up');

    const { objectName, publicUrl } = uploadResult;

    res.status(201).json({
      success: true,
      data: {
        videoUrl: publicUrl,
        objectName: objectName,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });

  } catch (error) {
    console.error('[UPLOAD ROUTE] Upload error:', error.message);
    throw new AppError(`Video upload failed: ${error.message}`, 500);
  }
}));

// POST /api/videos - Submit a video for verification
router.post('/', authenticate, asyncHandler(async (req, res) => {
  console.log('[SUBMIT ROUTE] Video submission request received');
  const { exercise, reps, weight, duration, videoUrl, thumbnailUrl } = req.body;

  if (!exercise || !reps) {
    console.error('[SUBMIT ROUTE] Missing exercise or reps');
    throw new AppError('Exercise and reps are required', 400);
  }

  if (!videoUrl) {
    console.error('[SUBMIT ROUTE] Missing videoUrl');
    throw new AppError('Video URL is required. Upload a video first using /api/videos/upload', 400);
  }

  // Check if user is admin - auto-verify their submissions
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });
  const isAdmin = user.accolades && user.accolades.includes('admin');

  const submission = await prisma.videoSubmission.create({
    data: {
      userId: req.user.id,
      exercise,
      reps,
      weight: weight || 0,
      duration,
      videoUrl,
      thumbnailUrl,
      status: isAdmin ? 'approved' : 'pending',
      ...(isAdmin && {
        verifiedByName: 'UNYIELD',
        verifiedAt: new Date(),
      }),
    },
  });

  console.log('[SUBMIT ROUTE] Submission saved successfully:', submission.id);

  res.status(201).json({
    success: true,
    data: submission,
    autoVerified: isAdmin,
  });
}));

// GET /api/videos - Get user's video submissions
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { status } = req.query;

  const where = { userId: req.user.id };
  if (status) {
    where.status = status;
  }

  const submissions = await prisma.videoSubmission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      verifiedBy: {
        select: { id: true, name: true, username: true }
      }
    }
  });

  res.json({
    success: true,
    data: submissions,
  });
}));

// GET /api/videos/queue - Get verification queue (for verifiers only)
router.get('/queue', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!canVerify(user)) {
    throw new AppError('You do not have permission to verify videos', 403);
  }

  const submissions = await prisma.videoSubmission.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: {
      user: {
        select: { id: true, name: true, username: true, profileImage: true }
      }
    }
  });

  res.json({
    success: true,
    data: submissions,
  });
}));

// GET /api/videos/appeals/queue - Get appeals queue (for verifiers only) - MUST BE BEFORE /:id
router.get('/appeals/queue', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!canVerify(user)) {
    throw new AppError('You do not have permission to review appeals', 403);
  }

  const appeals = await prisma.appeal.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: {
      user: {
        select: { id: true, name: true, username: true, profileImage: true }
      },
      videoSubmission: true
    }
  });

  res.json({
    success: true,
    data: appeals,
  });
}));

// GET /api/videos/reports/queue - Get reports queue (for verifiers only) - MUST BE BEFORE /:id
router.get('/reports/queue', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!canVerify(user)) {
    throw new AppError('You do not have permission to review reports', 403);
  }

  const reports = await prisma.report.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: {
      reporter: {
        select: { id: true, name: true, username: true }
      },
      videoSubmission: true
    }
  });

  res.json({
    success: true,
    data: reports,
  });
}));

// POST /api/videos/:id/verify - Verify (approve/reject) a video submission
router.post('/:id/verify', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!canVerify(user)) {
    throw new AppError('You do not have permission to verify videos', 403);
  }

  const { action, rejectionReason } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    throw new AppError('Action must be approve or reject', 400);
  }

  const submission = await prisma.videoSubmission.findUnique({
    where: { id: req.params.id }
  });

  if (!submission) {
    throw new AppError('Video submission not found', 404);
  }

  if (submission.status !== 'pending') {
    throw new AppError('Video has already been verified', 400);
  }

  // Cannot verify your own submission
  if (submission.userId === req.user.id) {
    throw new AppError('You cannot verify your own submission', 400);
  }

  const updatedSubmission = await prisma.videoSubmission.update({
    where: { id: req.params.id },
    data: {
      status: action === 'approve' ? 'approved' : 'rejected',
      verifiedById: req.user.id,
      verifiedByName: user.name,
      verifiedAt: new Date(),
      ...(action === 'reject' && {
        rejectionReason: rejectionReason || 'No reason provided'
      }),
    },
  });

  res.json({
    success: true,
    data: updatedSubmission,
  });
}));

// GET /api/videos/:id - Get a specific video submission
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const submission = await prisma.videoSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: { id: true, name: true, username: true, profileImage: true }
      },
      verifiedBy: {
        select: { id: true, name: true, username: true }
      }
    }
  });

  if (!submission) {
    throw new AppError('Video submission not found', 404);
  }

  res.json({
    success: true,
    data: submission,
  });
}));

// DELETE /api/videos/:id - Delete a video submission (owner only)
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const submission = await prisma.videoSubmission.findUnique({
    where: { id: req.params.id }
  });

  if (!submission) {
    throw new AppError('Video submission not found', 404);
  }

  // Must be the owner of the submission to delete it
  if (submission.userId !== req.user.id) {
    throw new AppError('You can only delete your own video submissions', 403);
  }

  // Delete from Object Storage
  if (submission.videoUrl) {
    await deleteVideo(submission.videoUrl);
  }

  // Delete the submission (cascade will delete reports and appeals)
  await prisma.videoSubmission.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Video deleted successfully',
  });
}));

// POST /api/videos/:id/report - Report a suspicious video
router.post('/:id/report', authenticate, asyncHandler(async (req, res) => {
  const { reportType, reason } = req.body;

  if (!reportType || !reason) {
    throw new AppError('Report type and reason are required', 400);
  }

  const validTypes = ['suspicious_lift', 'fake_video', 'inappropriate', 'spam', 'other'];
  if (!validTypes.includes(reportType)) {
    throw new AppError(`Invalid report type. Must be one of: ${validTypes.join(', ')}`, 400);
  }

  const submission = await prisma.videoSubmission.findUnique({
    where: { id: req.params.id }
  });

  if (!submission) {
    throw new AppError('Video submission not found', 404);
  }

  // Cannot report your own submission
  if (submission.userId === req.user.id) {
    throw new AppError('You cannot report your own submission', 400);
  }

  // Check if user already reported this video
  const existingReport = await prisma.report.findFirst({
    where: {
      reporterId: req.user.id,
      videoSubmissionId: req.params.id,
    }
  });

  if (existingReport) {
    throw new AppError('You have already reported this video', 400);
  }

  const report = await prisma.report.create({
    data: {
      reporterId: req.user.id,
      videoSubmissionId: req.params.id,
      reportType,
      reason,
      status: 'pending',
    },
  });

  res.status(201).json({
    success: true,
    message: 'Report submitted successfully',
    data: { id: report.id },
  });
}));

// POST /api/videos/:id/appeal - Appeal a rejected video
router.post('/:id/appeal', authenticate, asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    throw new AppError('Appeal reason is required', 400);
  }

  const submission = await prisma.videoSubmission.findUnique({
    where: { id: req.params.id }
  });

  if (!submission) {
    throw new AppError('Video submission not found', 404);
  }

  // Must be the owner of the submission
  if (submission.userId !== req.user.id) {
    throw new AppError('You can only appeal your own submissions', 403);
  }

  // Must be rejected to appeal
  if (submission.status !== 'rejected') {
    throw new AppError('You can only appeal rejected submissions', 400);
  }

  // Check if already appealed (unique constraint on videoSubmissionId)
  const existingAppeal = await prisma.appeal.findUnique({
    where: { videoSubmissionId: req.params.id }
  });

  if (existingAppeal) {
    throw new AppError('You have already appealed this submission', 400);
  }

  const appeal = await prisma.appeal.create({
    data: {
      userId: req.user.id,
      videoSubmissionId: req.params.id,
      reason,
      status: 'pending',
    },
  });

  res.status(201).json({
    success: true,
    message: 'Appeal submitted successfully',
    data: { id: appeal.id },
  });
}));

// POST /api/videos/appeals/:id/review - Review an appeal (for verifiers only)
router.post('/appeals/:id/review', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!canVerify(user)) {
    throw new AppError('You do not have permission to review appeals', 403);
  }

  const { action, reviewNotes } = req.body;

  if (!['approve', 'deny'].includes(action)) {
    throw new AppError('Action must be approve or deny', 400);
  }

  const appeal = await prisma.appeal.findUnique({
    where: { id: req.params.id }
  });

  if (!appeal) {
    throw new AppError('Appeal not found', 404);
  }

  if (appeal.status !== 'pending') {
    throw new AppError('Appeal has already been reviewed', 400);
  }

  const updatedAppeal = await prisma.appeal.update({
    where: { id: req.params.id },
    data: {
      status: action === 'approve' ? 'approved' : 'denied',
      reviewedById: req.user.id,
      reviewedByName: user.name,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes || '',
    },
  });

  // If appeal approved, update the video submission status
  if (action === 'approve') {
    await prisma.videoSubmission.update({
      where: { id: appeal.videoSubmissionId },
      data: {
        status: 'approved',
        verifiedById: req.user.id,
        verifiedByName: user.name,
        verifiedAt: new Date(),
        rejectionReason: null,
      },
    });
  }

  res.json({
    success: true,
    data: updatedAppeal,
  });
}));

// POST /api/videos/reports/:id/review - Review a report (for verifiers only)
router.post('/reports/:id/review', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!canVerify(user)) {
    throw new AppError('You do not have permission to review reports', 403);
  }

  const { action, reviewNotes, actionTaken } = req.body;

  if (!['resolve', 'dismiss'].includes(action)) {
    throw new AppError('Action must be resolve or dismiss', 400);
  }

  const report = await prisma.report.findUnique({
    where: { id: req.params.id }
  });

  if (!report) {
    throw new AppError('Report not found', 404);
  }

  if (report.status !== 'pending') {
    throw new AppError('Report has already been reviewed', 400);
  }

  const updatedReport = await prisma.report.update({
    where: { id: req.params.id },
    data: {
      status: action === 'resolve' ? 'resolved' : 'dismissed',
      reviewedById: req.user.id,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes || '',
      actionTaken: actionTaken || 'no_action',
    },
  });

  // If resolved and action is to reject the video
  if (action === 'resolve' && actionTaken === 'video_removed') {
    await prisma.videoSubmission.update({
      where: { id: report.videoSubmissionId },
      data: {
        status: 'rejected',
        verifiedById: req.user.id,
        verifiedByName: user.name,
        verifiedAt: new Date(),
        rejectionReason: 'Rejected due to report: ' + report.reportType,
      },
    });
  }

  res.json({
    success: true,
    data: updatedReport,
  });
}));

// POST /api/videos/blur - Blur faces in a video using LOCAL face detection (no cloud APIs)
router.post('/blur', authenticate, asyncHandler(async (req, res) => {
  console.log('[BLUR] Blur request received');

  const { videoUrl } = req.body;

  if (!videoUrl) {
    console.error('[BLUR] Missing videoUrl');
    throw new AppError('videoUrl is required', 400);
  }

  console.log('[BLUR] Processing video:', videoUrl.substring(0, 50) + '...');

  try {
    // Process video with face blur (uses local TensorFlow.js)
    console.log('[BLUR] Calling face blur service (local)...');
    const result = await blurVideoFromUrl(videoUrl);

    console.log('[BLUR] Processing complete:', { facesFound: result.facesFound });

    // Upload the blurred video to Oracle Cloud Object Storage
    console.log('[BLUR] Uploading blurred video to storage...');
    const uploadResult = await uploadVideo(
      result.buffer,
      `blurred_${Date.now()}.mp4`,
      'video/mp4'
    );

    console.log('[BLUR] Blurred video uploaded:', uploadResult.publicUrl);

    res.json({
      success: true,
      data: {
        blurredVideoUrl: uploadResult.publicUrl,
        objectName: uploadResult.objectName,
        facesFound: result.facesFound,
        originalVideoUrl: videoUrl
      },
      message: `Blurred ${result.facesFound} faces in video`
    });

  } catch (error) {
    console.error('[BLUR] Error:', error.message);

    // If blur fails, return original URL as fallback
    console.warn('[BLUR] Face blur failed, using original video');
    return res.json({
      success: true,
      data: {
        blurredVideoUrl: videoUrl,
        objectName: null,
        facesFound: 0,
        originalVideoUrl: videoUrl
      },
      message: 'Face blur service unavailable - original video used'
    });
  }
}));

module.exports = router;
