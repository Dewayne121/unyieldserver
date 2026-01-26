"""
Face Blur Microservice
Uses OpenCV to detect faces and apply Gaussian blur to detected regions
"""
import os
import sys
import cv2
import numpy as np
import tempfile
import requests
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = '/tmp'
MAX_VIDEO_LENGTH = 300  # 5 minutes max
BLUR_INTENSITY = 51  # Must be odd number, higher = more blur
FACE_DETECTION_SCALE = 0.25  # Scale down for faster detection
MIN_FACE_SIZE = 30  # Minimum face size in pixels

# Load face detection cascade
try:
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    print('[FACE_BLUR] Face cascade loaded successfully')
except Exception as e:
    print(f'[FACE_BLUR] Error loading face cascade: {e}')
    sys.exit(1)


def download_video(url):
    """Download video from URL to temp file"""
    try:
        print(f'[FACE_BLUR] Downloading video from {url}')
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
        for chunk in response.iter_content(chunk_size=8192):
            temp_file.write(chunk)
        temp_file.close()

        print(f'[FACE_BLUR] Video downloaded to {temp_file.name}')
        return temp_file.name
    except Exception as e:
        print(f'[FACE_BLUR] Error downloading video: {e}')
        raise


def detect_faces_in_frame(frame):
    """Detect faces in a single frame"""
    # Convert to grayscale for detection
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Detect faces
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(MIN_FACE_SIZE, MIN_FACE_SIZE)
    )

    return faces


def apply_face_blur(frame, faces):
    """Apply Gaussian blur to detected face regions"""
    blurred_frame = frame.copy()

    for (x, y, w, h) in faces:
        # Extract face region
        face_region = blurred_frame[y:y+h, x:x+w]

        # Apply Gaussian blur
        blurred_face = cv2.GaussianBlur(face_region, (99, 99), BLUR_INTENSITY)

        # Replace face region with blurred version
        blurred_frame[y:y+h, x:x+w] = blurred_face

    return blurred_frame


def process_video(input_path, output_path):
    """Process video: detect faces and apply blur"""
    try:
        print(f'[FACE_BLUR] Processing video: {input_path}')

        # Open video file
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise Exception('Could not open video file')

        # Get video properties
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f'[FACE_BLUR] Video properties: {width}x{height} @ {fps}fps, {total_frames} frames')

        # Setup video writer
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        frame_count = 0
        faces_found = 0

        # Process every frame (could optimize to process every Nth frame)
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_count += 1

            # Detect faces
            faces = detect_faces_in_frame(frame)

            if len(faces) > 0:
                faces_found += len(faces)
                # Apply blur to faces
                frame = apply_face_blur(frame, faces)

            # Write frame
            out.write(frame)

            # Progress logging every 30 frames
            if frame_count % 30 == 0:
                progress = (frame_count / total_frames) * 100
                print(f'[FACE_BLUR] Progress: {progress:.1f}% ({frame_count}/{total_frames} frames, {faces_found} faces found)')

        # Release resources
        cap.release()
        out.release()

        print(f'[FACE_BLUR] Video processing complete: {frame_count} frames processed, {faces_found} faces blurred')
        return True, faces_found

    except Exception as e:
        print(f'[FACE_BLUR] Error processing video: {e}')
        return False, 0


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'face-blur-microservice'
    })


@app.route('/blur', methods=['POST'])
def blur_video():
    """Main endpoint to blur faces in video"""
    try:
        data = request.get_json()

        if not data or 'videoUrl' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing videoUrl parameter'
            }), 400

        video_url = data['videoUrl']
        print(f'[FACE_BLUR] Received blur request for: {video_url}')

        # Download video
        input_path = download_video(video_url)

        # Create output file path
        output_path = input_path.replace('.mp4', '_blurred.mp4')

        # Process video
        success, faces_found = process_video(input_path, output_path)

        if not success:
            return jsonify({
                'success': False,
                'error': 'Failed to process video'
            }), 500

        # Read the processed video and return it (in production, upload to storage)
        # For now, we'll return the file info
        file_size = os.path.getsize(output_path)

        # Clean up input file
        try:
            os.remove(input_path)
        except:
            pass

        return jsonify({
            'success': True,
            'facesFound': faces_found,
            'outputPath': output_path,
            'fileSize': file_size,
            'message': f'Blurred {faces_found} faces in video'
        })

    except Exception as e:
        print(f'[FACE_BLUR] Error in blur endpoint: {e}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('NODE_ENV') !== 'production'

    print('[FACE_BLUR] Starting face blur microservice...')
    print(f'[FACE_BLUR] Running on port {port}')

    app.run(host='0.0.0.0', port=port, debug=debug)
