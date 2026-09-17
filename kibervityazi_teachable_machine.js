/**
 * Автор: Д. С. Петелина
 * Ученик: М. Денищенко
 * ДДТ «Бронницы»
 * Конференция школьников «Юные учёные и инженеры — Отечеству»
 * «Робофинист», 2026 год
 */

(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('Расширение Teachable Machine должно запускаться без песочницы.');
  }

  const ArgumentType = Scratch.ArgumentType;
  const BlockType = Scratch.BlockType;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`Не удалось загрузить библиотеку: ${src}`));
      document.head.appendChild(script);
    });
  }

  class TeachableMachineExtension {
    constructor() {
      // Загруженная модель и результаты последнего распознавания.
      this.model = null;
      this.modelBaseUrl = '';
      this.labels = [];
      this.confidences = Object.create(null);
      this.bestLabel = '';
      this.bestConfidence = 0;
      this.status = 'модель не загружена';

      // Камера и цикл распознавания.
      this.running = false;
      this.video = null;
      this.stream = null;
      this.loopHandle = 0;

      // Окно предпросмотра с видео и результатами.
      this.preview = null;
      this.previewVisible = false;

      // Список камер и выбранная камера.
      this.cameraDevices = [];
      this.selectedCameraId = '';
      this.selectedCameraName = 'камера по умолчанию';
    }

    getInfo() {
      return {
        id: 'teachablemachine',
        name: 'Teachable Machine',
        color1: '#59B83B',
        color2: '#46942F',
        color3: '#357524',
        blocks: [
          {
            opcode: 'loadModel',
            blockType: BlockType.COMMAND,
            text: 'загрузить модель [URL]',
            arguments: {
              URL: {
                type: ArgumentType.STRING,
                defaultValue: 'https://teachablemachine.withgoogle.com/models/XXXXXXXXX/'
              }
            }
          },
          {
            opcode: 'refreshCameras',
            blockType: BlockType.COMMAND,
            text: 'обновить список камер'
          },
          {
            opcode: 'selectCamera',
            blockType: BlockType.COMMAND,
            text: 'выбрать камеру [CAMERA]',
            arguments: {
              CAMERA: {
                type: ArgumentType.STRING,
                menu: 'CAMERAS'
              }
            }
          },
          {
            opcode: 'currentCamera',
            blockType: BlockType.REPORTER,
            text: 'текущая камера',
            disableMonitor: false
          },
          {
            opcode: 'startRecognition',
            blockType: BlockType.COMMAND,
            text: 'начать распознавание'
          },
          {
            opcode: 'stopRecognition',
            blockType: BlockType.COMMAND,
            text: 'остановить распознавание'
          },
          {
            opcode: 'showPreview',
            blockType: BlockType.COMMAND,
            text: 'показать окно камеры'
          },
          {
            opcode: 'hidePreview',
            blockType: BlockType.COMMAND,
            text: 'скрыть окно камеры'
          },
          '---',
          {
            opcode: 'bestResult',
            blockType: BlockType.REPORTER,
            text: 'результат распознавания',
            disableMonitor: false
          },
          {
            opcode: 'bestConfidenceReporter',
            blockType: BlockType.REPORTER,
            text: 'уверенность результата',
            disableMonitor: false
          },
          {
            opcode: 'confidenceForLabel',
            blockType: BlockType.REPORTER,
            text: 'надёжность [LABEL]',
            arguments: {
              LABEL: {
                type: ArgumentType.STRING,
                menu: 'LABELS'
              }
            }
          },
          {
            opcode: 'labelValue',
            blockType: BlockType.REPORTER,
            text: 'метка [LABEL]',
            arguments: {
              LABEL: {
                type: ArgumentType.STRING,
                menu: 'LABELS'
              }
            }
          },
          {
            opcode: 'labelCount',
            blockType: BlockType.REPORTER,
            text: 'количество меток'
          },
          {
            opcode: 'labelByIndex',
            blockType: BlockType.REPORTER,
            text: 'метка номер [INDEX]',
            arguments: {
              INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 }
            }
          },
          '---',
          {
            opcode: 'isModelReady',
            blockType: BlockType.BOOLEAN,
            text: 'модель готова?'
          },
          {
            opcode: 'isRecognizing',
            blockType: BlockType.BOOLEAN,
            text: 'распознавание запущено?'
          },
          {
            opcode: 'statusReporter',
            blockType: BlockType.REPORTER,
            text: 'статус модели',
            disableMonitor: false
          }
        ],
        menus: {
          LABELS: {
            acceptReporters: true,
            items: 'getLabelMenuItems'
          },
          CAMERAS: {
            acceptReporters: true,
            items: 'getCameraMenuItems'
          }
        }
      };
    }

    getCameraMenuItems() {
      if (!this.cameraDevices.length) {
        return [{ text: 'камера по умолчанию', value: '' }];
      }
      return this.cameraDevices.map((device, index) => ({
        text: device.label || `камера ${index + 1}`,
        value: device.deviceId
      }));
    }

    async refreshCameras() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) {
          this.status = 'браузер не поддерживает список камер';
          return;
        }
        // Названия камер часто скрыты до первого разрешения на камеру.
        let tempStream = null;
        try {
          if (!this.stream) {
            tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        } catch (_) {
          // Отказ в доступе не мешает попытаться получить список камер.
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.cameraDevices = devices.filter(device => device.kind === 'videoinput');
        if (tempStream) tempStream.getTracks().forEach(track => track.stop());
        this.status = this.cameraDevices.length
          ? `найдено камер: ${this.cameraDevices.length}`
          : 'камеры не найдены';
      } catch (error) {
        this.status = `ошибка списка камер: ${error.message}`;
      }
    }

    async selectCamera(args) {
      const deviceId = String(args.CAMERA || '');
      this.selectedCameraId = deviceId;
      const found = this.cameraDevices.find(device => device.deviceId === deviceId);
      this.selectedCameraName = found?.label || (deviceId ? 'выбранная камера' : 'камера по умолчанию');
      const wasRunning = this.running;
      if (wasRunning) {
        await this.stopRecognition();
        await this.startRecognition();
      }
    }

    currentCamera() {
      return this.selectedCameraName;
    }

    getLabelMenuItems() {
      if (!this.labels.length) return [{ text: 'сначала загрузите модель', value: '' }];
      return this.labels.map(label => ({ text: label, value: label }));
    }

    async ensureLibraries() {
      this.status = 'загрузка библиотек';
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js');
      if (!window.tmImage) throw new Error('Библиотека Teachable Machine не загрузилась');
    }

    normalizeBaseUrl(rawUrl) {
      let url = String(rawUrl || '').trim();
      if (!url) throw new Error('Не указана ссылка на модель');
      url = url.replace(/(model\.json|metadata\.json)$/i, '');
      if (!url.endsWith('/')) url += '/';
      return url;
    }

    async loadModel(args) {
      try {
        await this.stopRecognition();
        await this.ensureLibraries();
        this.modelBaseUrl = this.normalizeBaseUrl(args.URL);
        this.status = 'загрузка модели';
        this.model = await window.tmImage.load(
          this.modelBaseUrl + 'model.json',
          this.modelBaseUrl + 'metadata.json'
        );
        this.labels = this.model.getClassLabels ? this.model.getClassLabels() : [];
        if (!this.labels.length) {
          const total = this.model.getTotalClasses();
          this.labels = Array.from({ length: total }, (_, i) => `класс ${i + 1}`);
        }
        this.confidences = Object.create(null);
        for (const label of this.labels) this.confidences[label] = 0;
        this.bestLabel = '';
        this.bestConfidence = 0;
        this.status = 'готова к работе';
      } catch (error) {
        this.status = `ошибка: ${error.message}`;
        console.error('[Teachable Machine]', error);
      }
    }

    async startRecognition() {
      if (!this.model) {
        this.status = 'сначала загрузите модель';
        return;
      }
      if (this.running) return;

      try {
        this.status = 'запрос камеры';
        this.video = document.createElement('video');
        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.muted = true;

        const videoConstraints = this.selectedCameraId
          ? { deviceId: { exact: this.selectedCameraId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };

        this.stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false
        });
        this.video.srcObject = this.stream;
        await this.video.play();

        const track = this.stream.getVideoTracks()[0];
        if (track) {
          const settings = track.getSettings ? track.getSettings() : {};
          const found = this.cameraDevices.find(device => device.deviceId === settings.deviceId);
          this.selectedCameraName = track.label || found?.label || this.selectedCameraName;
          if (!this.selectedCameraId && settings.deviceId) this.selectedCameraId = settings.deviceId;
        }

        this.running = true;
        this.status = 'распознавание запущено';
        if (this.previewVisible) this.attachPreviewVideo();
        this.schedulePrediction();
      } catch (error) {
        this.status = `камера недоступна: ${error.message}`;
        console.error('[Teachable Machine]', error);
      }
    }

    schedulePrediction() {
      if (!this.running) return;
      this.loopHandle = requestAnimationFrame(async () => {
        try {
          if (this.video && this.video.readyState >= 2 && this.model) {
            const predictions = await this.model.predict(this.video, true);
            let best = null;
            for (const prediction of predictions) {
              const label = String(prediction.className);
              const probability = Number(prediction.probability) || 0;
              this.confidences[label] = probability;
              if (!best || probability > best.probability) {
                best = { label, probability };
              }
            }
            if (best) {
              this.bestLabel = best.label;
              this.bestConfidence = best.probability;
            }
          }
        } catch (error) {
          this.status = `ошибка распознавания: ${error.message}`;
          console.error('[Teachable Machine]', error);
        }
        this.schedulePrediction();
      });
    }

    async stopRecognition() {
      this.running = false;
      if (this.loopHandle) cancelAnimationFrame(this.loopHandle);
      this.loopHandle = 0;
      if (this.stream) {
        for (const track of this.stream.getTracks()) track.stop();
      }
      this.stream = null;
      if (this.video) {
        this.video.srcObject = null;
        this.video.remove();
      }
      this.video = null;
      if (this.preview) {
        const placeholder = this.preview.querySelector('.tm-placeholder');
        if (placeholder) placeholder.style.display = 'block';
      }
      if (this.model) this.status = 'готова к работе';
    }

    createPreview() {
      if (this.preview) return;
      const box = document.createElement('div');
      box.style.cssText = [
        'position:fixed', 'left:24px', 'top:90px', 'width:300px', 'height:auto',
        'min-width:220px', 'min-height:90px', 'max-width:90vw', 'max-height:85vh',
        'z-index:999999', 'background:white', 'border:1px solid #bbb',
        'border-radius:12px', 'box-shadow:0 6px 24px rgba(0,0,0,.25)',
        'font-family:sans-serif', 'resize:both', 'overflow:auto', 'box-sizing:border-box'
      ].join(';');

      box.innerHTML = `
        <div class="tm-header" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f2f2f2;border-radius:12px 12px 0 0;cursor:move;user-select:none;position:sticky;top:0;z-index:2">
          <div style="font-weight:700;flex:1">Результат распознавания</div>
          <button class="tm-minimize" title="Свернуть" style="border:0;background:transparent;font-size:18px;cursor:pointer;padding:0 4px">–</button>
          <button class="tm-close" title="Закрыть" style="border:0;background:transparent;font-size:18px;cursor:pointer;padding:0 4px">×</button>
        </div>
        <div class="tm-content" style="padding:10px">
          <div class="tm-video"></div>
          <div class="tm-placeholder" style="padding:30px;text-align:center;color:#666">Камера не запущена</div>
          <div class="tm-result" style="margin-top:8px;font-size:16px;font-weight:600"></div>
          <div class="tm-bars" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div>
        </div>`;

      document.body.appendChild(box);
      this.preview = box;

      const header = box.querySelector('.tm-header');
      const content = box.querySelector('.tm-content');
      const minimizeButton = box.querySelector('.tm-minimize');
      const closeButton = box.querySelector('.tm-close');

      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;

      header.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        dragging = true;
        const rect = box.getBoundingClientRect();
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        header.setPointerCapture(event.pointerId);
        event.preventDefault();
      });

      header.addEventListener('pointermove', event => {
        if (!dragging) return;
        const maxLeft = Math.max(0, window.innerWidth - 80);
        const maxTop = Math.max(0, window.innerHeight - 45);
        const left = Math.min(maxLeft, Math.max(0, event.clientX - offsetX));
        const top = Math.min(maxTop, Math.max(0, event.clientY - offsetY));
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.right = 'auto';
      });

      const stopDragging = event => {
        dragging = false;
        try {
          header.releasePointerCapture(event.pointerId);
        } catch (_) {
          // Захват указателя мог уже завершиться или быть передан другому элементу.
        }
      };
      header.addEventListener('pointerup', stopDragging);
      header.addEventListener('pointercancel', stopDragging);

      minimizeButton.addEventListener('click', () => {
        const collapsed = content.style.display === 'none';
        content.style.display = collapsed ? 'block' : 'none';
        minimizeButton.textContent = collapsed ? '–' : '+';
        box.style.height = collapsed ? 'auto' : '42px';
        box.style.resize = collapsed ? 'both' : 'none';
        box.style.overflow = collapsed ? 'auto' : 'hidden';
      });

      closeButton.addEventListener('click', () => this.hidePreview());

      const palette = [
        '#F6A623', '#F46B6B', '#4A90E2', '#63C96B', '#9B6DE3',
        '#21B7B7', '#F07FB2', '#8C9B3B', '#D17A22', '#5C6BC0'
      ];

      const update = () => {
        if (!this.preview) return;
        const result = this.preview.querySelector('.tm-result');
        if (result) {
          const pct = (this.bestConfidence * 100).toFixed(1);
          result.textContent = this.bestLabel
            ? `Распознано: ${this.bestLabel} — ${pct}%`
            : this.status;
        }

        const bars = this.preview.querySelector('.tm-bars');
        if (bars) {
          const currentLabels = this.labels.length ? this.labels : Object.keys(this.confidences);
          if (!currentLabels.length) {
            bars.innerHTML = '<div style="color:#777;font-size:13px">Метки появятся после загрузки модели</div>';
          } else {
            bars.replaceChildren();
            currentLabels.forEach((label, index) => {
              const confidence = Math.max(0, Math.min(1, Number(this.confidences[label] || 0)));
              const percent = confidence * 100;
              const color = palette[index % palette.length];

              const row = document.createElement('div');
              row.style.cssText = 'display:grid;grid-template-columns:minmax(70px,auto) 1fr 54px;align-items:center;gap:8px;font-size:13px';

              const name = document.createElement('div');
              name.textContent = label;
              name.title = label;
              name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600';

              const track = document.createElement('div');
              track.style.cssText = 'height:16px;background:#ececec;border-radius:8px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)';

              const fill = document.createElement('div');
              fill.style.cssText = `height:100%;width:${percent.toFixed(2)}%;background:${color};border-radius:8px;transition:width .12s linear`;
              track.appendChild(fill);

              const value = document.createElement('div');
              value.textContent = `${percent.toFixed(1)}%`;
              value.style.cssText = 'text-align:right;font-variant-numeric:tabular-nums';

              row.append(name, track, value);
              bars.appendChild(row);
            });
          }
        }
        requestAnimationFrame(update);
      };
      update();
    }

    attachPreviewVideo() {
      if (!this.preview || !this.video) return;
      const holder = this.preview.querySelector('.tm-video');
      const placeholder = this.preview.querySelector('.tm-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      this.video.style.cssText = 'display:block;width:100%;border-radius:8px;transform:scaleX(-1)';
      holder.replaceChildren(this.video);
    }

    showPreview() {
      this.previewVisible = true;
      this.createPreview();
      this.preview.style.display = 'block';
      this.attachPreviewVideo();
    }

    hidePreview() {
      this.previewVisible = false;
      this.cameraDevices = [];
      this.selectedCameraId = '';
      this.selectedCameraName = 'камера по умолчанию';
      if (this.preview) this.preview.style.display = 'none';
    }

    bestResult() { return this.bestLabel; }
    bestConfidenceReporter() { return this.bestConfidence; }
    confidenceForLabel(args) { return Number(this.confidences[String(args.LABEL)] || 0); }
    labelValue(args) { return String(args.LABEL || ''); }
    labelCount() { return this.labels.length; }
    labelByIndex(args) {
      const index = Math.floor(Number(args.INDEX)) - 1;
      return index >= 0 && index < this.labels.length ? this.labels[index] : '';
    }
    isModelReady() { return Boolean(this.model); }
    isRecognizing() { return this.running; }
    statusReporter() { return this.status; }
  }

  Scratch.extensions.register(new TeachableMachineExtension());
})(Scratch);
