class AudioCapture {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
  }

  async start(onAudioData) {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        const audioData = e.inputBuffer.getChannelData(0);
        const buffer = new Float32Array(audioData);
        onAudioData(buffer);
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      console.log('Audio capture started');
    } catch (error) {
      console.error('Audio capture error:', error);
      throw error;
    }
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    console.log('Audio capture stopped');
  }
}

module.exports = AudioCapture;