function getSoundData(filename) {
    return new Promise(function(resolve, reject) {
        let pathname = window.location.pathname;
        pathname = pathname.substring(0, pathname.lastIndexOf('/'));
        let request = new XMLHttpRequest();
        let url = 'http://' + window.location.hostname + ":2794" + pathname + "/" + filename;
        console.log(url);
        request.open('GET', url);
        request.responseType = 'arraybuffer';
        request.onload = function() {
            resolve(request.response);
        }
        request.onerror = function() {
            reject(request.statusText);
        }
        request.send();
    });
}

const BASE_FREQS = [
    55.0000, // A
    58.2705, // A#
    61.7354, // B
    65.4064, // C
    69.2957, // C#
    73.4162, // D
    77.7817, // D#
    82.4069, // E
    87.3071, // F
    92.4986, // F#
    97.9989, // G
    103.826, // G#
];

const NOTES = {
    A: 0,
    A_S: 1,
    B_F: 1,
    B: 2,
    C: 3,
    C_S: 4,
    D_F: 4,
    D: 5,
    D_S: 6,
    E_F: 6,
    E: 7,
    F: 8,
    F_S: 9,
    G_F: 9,
    G: 10,
    G_S: 11,
    A_F: 11
};

function getFreq(note, octave) {
    return BASE_FREQS[note] * (1 << octave);
}

function initSynth(audioCtx, synthSpec, masterGain) {
    // TODO: consider making this more efficient if no modulation gain/freq are 0.
    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(synthSpec.filterCutoff, audioCtx.currentTime);
    filterNode.Q.value = synthSpec.filterQ;
    filterModFreq = audioCtx.createOscillator();
    filterModFreq.frequency.setValueAtTime(synthSpec.filterModFreq, audioCtx.currentTime);
    filterModGain = audioCtx.createGain();
    filterModGain.gain.setValueAtTime(synthSpec.filterModGain, audioCtx.currentTime);
    filterModFreq.connect(filterModGain).connect(filterNode.frequency);
    filterModFreq.start();

    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(synthSpec.gain, audioCtx.currentTime);
    filterNode.connect(gainNode);
    gainNode.connect(masterGain);
    let voices = [];
    for (let i = 0; i < synthSpec.voiceSpecs.length; ++i) {
        // TODO: consider making this more efficient if osc2Gain == 0 by only initializing one oscillator.
        let osc2Detune = synthSpec.voiceSpecs[i].osc2Detune;
        let osc2GainValue = synthSpec.voiceSpecs[i].osc2Gain;

        let defaultFreq = getFreq(NOTES.A, 3);

        let osc1 = audioCtx.createOscillator();
        osc1.type = synthSpec.voiceSpecs[i].osc1Type;
        osc1.frequency.setValueAtTime(defaultFreq, audioCtx.currentTime);

        let osc2 = audioCtx.createOscillator();
        osc2.type = synthSpec.voiceSpecs[i].osc2Type;
        osc2.detune.setValueAtTime(osc2Detune, audioCtx.currentTime);
        osc2.frequency.setValueAtTime(defaultFreq, audioCtx.currentTime);

        let voiceGainNode = audioCtx.createGain();
        voiceGainNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
        voiceGainNode.connect(filterNode);
        osc1.connect(voiceGainNode);
        let osc2GainNode = audioCtx.createGain();
        osc2GainNode.gain.setValueAtTime(osc2GainValue, audioCtx.currentTime);
        osc2GainNode.connect(voiceGainNode);
        osc2.connect(osc2GainNode);

        osc1.start();
        osc2.start();

        voices.push({
            osc1: osc1,
            osc2: osc2,
            gain: voiceGainNode,
            osc2Gain: osc2GainNode,
        });
    }

    return {
        voices: voices,
        filter: filterNode,
        filterModFreq: filterModFreq,
        filterModGain: filterModGain,
        gain: gainNode,
        attackTime: synthSpec.attackTime,
        decayTime: (synthSpec.decayTime === undefined) ? 0.0 : synthSpec.decayTime,
        sustainLevel: (synthSpec.sustainLevel === undefined) ? 1.0 : synthSpec.sustainLevel,
        releaseTime: synthSpec.releaseTime,
        filterDefault: synthSpec.filterCutoff,
        // TODO: These should be per-voice.
        filterEnvAttack: synthSpec.filterEnvAttack,
        filterEnvRelease: synthSpec.filterEnvRelease,
        filterEnvIntensity: synthSpec.filterEnvIntensity
    };
}

function initSound() {
    // let soundNames = ['kick', 'hihat', 'cowbell', 'drone'];
    let soundNames = ['kick', 'snare'];
    let sounds = soundNames.map(function(soundName) {
        return getSoundData(soundName + '.wav')
    });
    let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return Promise.all(sounds).then(function(loadedSounds) {
        return Promise.all(loadedSounds.map(function(loadedSound) {
            return audioCtx.decodeAudioData(loadedSound);
        }));
    }).then(function(decodedSounds) {
        let masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);

        let synthSpecs = [
            {
                gain: 0.25,
                filterCutoff: 1100,
                filterQ: 0.0,
                filterModFreq: 0,
                filterModGain: 0,
                attackTime: 0.0,
                releaseTime: 0.07,
                filterEnvAttack: 0.0,
                filterEnvRelease: 0.0,
                filterEnvIntensity: 0.0,
                voiceSpecs: [
                    {
                        osc1Type: 'square',
                        osc2Type: 'sawtooth',
                        osc2Gain: 0.5,
                        osc2Detune: 50
                    },
                    {
                        osc1Type: 'square',
                        osc2Type: 'sawtooth',
                        osc2Gain: 0.5,
                        osc2Detune: 50
                    }
                ]
            },
            {
                gain: 0.25,
                filterCutoff: 1100,
                filterModFreq: 0,
                filterQ: 0.0,
                filterModGain: 0,
                attackTime: 0.0,
                releaseTime: 0.07,
                filterEnvAttack: 0.0,
                filterEnvRelease: 0.0,
                filterEnvIntensity: 0.0,
                voiceSpecs: [
                    {
                        osc1Type: 'square',
                        osc2Type: 'sawtooth',
                        osc2Gain: 0.0,
                        osc2Detune: 0
                    }
                ]
            },
            {
                // Filter mod env test
                gain: 0.25,
                filterCutoff: 50,
                filterModFreq: 0,
                filterQ: 16.0,
                filterModGain: 0,
                attackTime: 0.0,
                releaseTime: 0.3,
                filterEnvAttack: 0.05,
                filterEnvRelease: 0.1,
                filterEnvIntensity: 300.0,
                voiceSpecs: [
                    {
                        osc1Type: 'sawtooth',
                        osc2Type: 'sawtooth',
                        osc2Gain: 0.3,
                        osc2Detune: -1200
                    }
                ]
            },
            {
                // Bass
                gain: 0.5,
                filterCutoff: 300,
                filterQ: 0.0,
                filterModFreq: 0,
                filterModGain: 0,
                attackTime: 0.0,
                releaseTime: 0.5,
                filterEnvAttack: 0.0,
                filterEnvRelease: 0.0,
                filterEnvIntensity: 0.0,
                voiceSpecs: [
                    { osc1Type: 'square',
                      osc2Type: 'sine',
                      osc2Gain: 0.0,
                      osc2Detune: 0.0 }
                ]
            },
            {
                // Laserbeam chord
                gain: 0.25,
                filterCutoff: 10000.0,
                filterQ: 0.0,
                filterModFreq: 0,
                filterModGain: 0,
                attackTime: 0.001,
                decayTime: 0.025,
                sustainLevel: 0.1,
                releaseTime: 0.2,
                filterEnvAttack: 0.0,
                filterEnvRelease: 0.0,
                filterEnvIntensity: 0.0,
                voiceSpecs: [
                    { osc1Type: 'sawtooth',
                      osc2Type: 'sawtooth',
                      osc2Gain: 0.8,
                      osc2Detune: 30.0 },
                    { osc1Type: 'sawtooth',
                      osc2Type: 'sawtooth',
                      osc2Gain: 0.8,
                      osc2Detune: 20.0 },
                    { osc1Type: 'sawtooth',
                      osc2Type: 'sawtooth',
                      osc2Gain: 0.8,
                      osc2Detune: 20.0 },
                    { osc1Type: 'sawtooth',
                      osc2Type: 'sawtooth',
                      osc2Gain: 0.8,
                      osc2Detune: 20.0 }
                ]
            }
        ];
        let synths = [];
        let auxSynths = [];
        for (let i = 0; i < synthSpecs.length; ++i) {
            synths.push(initSynth(audioCtx, synthSpecs[i], masterGain));
            auxSynths.push(initSynth(audioCtx, synthSpecs[i], masterGain));
        }

        // drone sound
        // let droneSource = audioCtx.createBufferSource();
        // droneSource.buffer = decodedSounds[3];
        // droneSource.loop = true;
        // droneSource.loopStart = 1.0;
        // // SUPER weird: for some reason we *need* to set loopEnd for the sample to loop correctly
        // // (even though the sample length is exactly this length).
        // droneSource.loopEnd = 4.0
        // let droneFilter = audioCtx.createBiquadFilter();
        // droneFilter.type = 'lowpass';
        // // droneFilter.frequency.setValueAtTime(100, audioCtx.currentTime);
        // droneFilter.frequency.value = 100.0;
        // let droneGain = audioCtx.createGain();
        // // droneGain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        // droneGain.gain.value = 0.0;
        // droneSource.connect(droneFilter);
        // droneFilter.connect(droneGain);
        // droneGain.connect(masterGain);
        // droneSource.start(0);

        let sampleSounds = [];
        for (let i = 0; i < decodedSounds.length; ++i) {
            let sampleGainNode = audioCtx.createGain();
            sampleGainNode.gain.value = 0.5;
            sampleGainNode.connect(masterGain);
            sampleSounds.push({ buffer: decodedSounds[i], gainNode: sampleGainNode });
        }
        // Set hihat to lower gain
        sampleSounds[1].gainNode.gain.value = 0.15

        return {
            audioCtx: audioCtx,
            drumSounds: sampleSounds,
            // droneNode: droneSource,
            // droneFilter: droneFilter,
            // droneGain: droneGain,
            synths: synths,
            auxSynths: auxSynths,
            masterGain: masterGain
        }
    });
}

function adsrEnvelope(audioParam, currentTime, velocity, attackTime, decayTime, sustainLevel, releaseTime) {
    audioParam.cancelScheduledValues(currentTime);
    audioParam.setValueAtTime(0.0, currentTime);
    audioParam.linearRampToValueAtTime(velocity, currentTime + attackTime);
    audioParam.linearRampToValueAtTime(sustainLevel * velocity, currentTime + attackTime + decayTime)
    audioParam.linearRampToValueAtTime(0.0, currentTime + attackTime + decayTime + releaseTime);
}

function synthPlayVoice(synth, voiceIdx, freq, sustain, audioCtx, velocity = 1.0) {
    let voice = synth.voices[voiceIdx];
    voice.osc1.frequency.setValueAtTime(freq, audioCtx.currentTime);
    voice.osc2.frequency.setValueAtTime(freq, audioCtx.currentTime);

    adsrEnvelope(voice.gain.gain, audioCtx.currentTime, velocity, synth.attackTime,
        synth.decayTime, synth.sustainLevel, synth.releaseTime);

    synth.filter.frequency.cancelScheduledValues(audioCtx.currentTime);
    synth.filter.frequency.setValueAtTime(synth.filterDefault, audioCtx.currentTime);
    synth.filter.frequency.linearRampToValueAtTime(synth.filterDefault + synth.filterEnvIntensity, audioCtx.currentTime + synth.filterEnvAttack);
    synth.filter.frequency.linearRampToValueAtTime(synth.filterDefault, audioCtx.currentTime + synth.filterEnvAttack + synth.filterEnvRelease);
}

// TODO: dedup with above function.
function synthPlayVoices(synth, freqs, audioCtx, velocity = 1.0) {
    let seenFreqs = new Set();
    for (let i = 0; i < freqs.length && i < synth.voices.length; ++i) {
        if (seenFreqs.has[freqs[i]]) {
            continue;
        }
        seenFreqs.add(freqs[i]);
        let voice = synth.voices[i];
        voice.osc1.frequency.setValueAtTime(freqs[i], audioCtx.currentTime);
        voice.osc2.frequency.setValueAtTime(freqs[i], audioCtx.currentTime);

        adsrEnvelope(voice.gain.gain, audioCtx.currentTime, velocity, synth.attackTime,
            synth.decayTime, synth.sustainLevel, synth.releaseTime);
    }
    synth.filter.frequency.cancelScheduledValues(audioCtx.currentTime);
    synth.filter.frequency.setValueAtTime(synth.filterDefault, audioCtx.currentTime);
    synth.filter.frequency.linearRampToValueAtTime(synth.filterDefault + synth.filterEnvIntensity, audioCtx.currentTime + synth.filterEnvAttack);
    synth.filter.frequency.linearRampToValueAtTime(synth.filterDefault, audioCtx.currentTime + synth.filterEnvAttack + synth.filterEnvRelease);
}

function synthReleaseVoice(synth, voiceIdx, audioCtx) {
    let voice = synth.voices[voiceIdx];
    voice.gain.gain.setValueAtTime(0.0, audioCtx.currentTime);
}

function playSoundFromBuffer(audioCtx, sampleSound, velocity = 1.0) {
    let source = audioCtx.createBufferSource();
    source.buffer = sampleSound.buffer;
    // Maybe cache this yo
    let velGain = audioCtx.createGain();
    velGain.gain.value = velocity;
    source.connect(velGain);
    velGain.connect(sampleSound.gainNode);
    // source.connect(sampleSound.gainNode);
    source.start(0);
}