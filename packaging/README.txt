Mix Atlas - Windows folder distribution

1. Install Python 3.13 x64 from python.org.
2. Keep this ENTIRE folder in a writable location (not Program Files).
3. Run Setup.cmd once, or Setup-CUDA.cmd for NVIDIA GPU support.
   Setup downloads Python dependencies into resources/app/.venv.
4. Launch MixAtlas.exe. Node.js and npm are not required on the destination PC.

Python and model weights are NOT bundled. The first source separation downloads
the Demucs model. Audio processing stays local; audio is never uploaded.
The GPU setup downloads approximately 3.5 GB. NVIDIA drivers are not modified.

This is a folder distribution, not a single executable or an installer.
Do not move only MixAtlas.exe. Keep LICENSE and LICENSES.chromium.html included.
Python package licenses are installed with their distributions during setup.
No user tracks, settings, model weights, analysis history or cached stems from
the development PC are included. Build metadata is in build-info.json.

This executable is not code-signed. Test on a clean destination PC before
distributing publicly. The developer's runtime test uses an existing Python
environment; it does not replace a clean-machine installation test.
