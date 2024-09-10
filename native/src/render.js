const { ipcRenderer } = require('electron');
const { SerialPort } = require('serialport');
const { Notyf } = require('notyf');

let notyf = new Notyf({ ripple: false, duration: 3500 });

let timer = {
  connect: undefined,
};

// UI mode; record, competitive, settings
let mode = "record";

let controller = {
  device: {},
  id: undefined,
  connected: false,
  time_synced: false,
  start: undefined,
  measuring: false,
};

let active_sensors = {
  competitive: [],
  record: {
    start: null,
    end: null,
  },
};

/*******************************************************************************
 * serial port opened
 ******************************************************************************/
ipcRenderer.on('serial-open', (evt, data) => {
  /*************************************************************************
   * protocol $HELLO: greetings!
   *   request : $HELLO
   *   response: $HI <%03d controller id>
   ************************************************************************/
  ipcRenderer.send('serial-request', '$HELLO'); // communication check
});

/*******************************************************************************
 * serial data received
 ******************************************************************************/
ipcRenderer.on('serial-data', (evt, data) => {
  let str = String.fromCharCode(...data.data);
  console.log(str)

  // ignore non-protocol messages
  if (str[0] !== "$") {
    return;
  }

  // $HELLO
  if (str.includes("$HI")) {
    controller.id = Number(str.substr(4, 3));
    controller.connected = true;
    document.getElementById('connect').classList.remove('red');
    document.getElementById('connect').classList.add('green');
    document.getElementById('controller-id').innerHTML = `<i class="fa fw fa-hashtag"></i>${controller.id}`;
    document.querySelectorAll('.active-connect').forEach(el => el.classList.remove('disabled'));
    document.getElementById('controller-status').innerText = '연결됨';
    document.getElementById('controller-status-color').style.color = 'green';
    notyf.success(`${controller.id}번 컨트롤러 연결 완료 (${controller.device.path})`);

    if (timer.connect) {
      clearTimeout(timer.connect);
    }
  }

  // $SENSOR
  else if (str.includes("$LSNTP")) {
    document.getElementById('controller-status').innerText = '센서 시간 동기화 중...';
    document.getElementById('controller-status-color').style.color = 'cornflowerblue';
    notyf.success('센서 시간 동기화 중...');
  }

  // $SENSOR
  else if (str.includes("$READY ")) {
    const id = Number(str.substr(7, 3));
    const offset = Number(str.substr(10));

    document.querySelectorAll('input.sensor-id').forEach(el => {
      if (id === Number(el.value)) {
        console.log(el.parentElement.nextElementSibling);
        el.parentElement.nextElementSibling.innerText = `(${offset} ms)`;
      }
    });

    notyf.success(`${id}번 센서 시간 오프셋: ${offset} ms`);
  }

  // $SENSOR
  else if (str.includes("$READY-ALL")) {
    controller.time_synced = true;
    document.getElementById('controller-status').innerText = '계측 대기';
    document.getElementById('controller-status-color').style.color = 'green';
    document.querySelectorAll('.active-ready').forEach(el => el.classList.remove('disabled'));
    notyf.success('센서 시간 동기화 완료 / 계측 대기');
  }

  // $GREEN
  else if (str.includes("$START")) {
    controller.start = new Date();
    controller.measuring = true;
    document.getElementById('controller-status').innerText = '계측 중...';
    document.getElementById('controller-status-color').style.color = 'purple';
    notyf.success('계측 시작');
  }

  // $RED, $OFF
  else if (str.includes("$OK")) {
    document.getElementById('controller-status').innerText = '계측 대기';
    document.getElementById('controller-status-color').style.color = 'green';

    if (controller.measuring) {
      controller.measuring = false;
      notyf.success('계측 종료');
    }
  }
});

/*******************************************************************************
 * serial failure
 ******************************************************************************/
ipcRenderer.on('serial-error', (evt, data) => {
  document.getElementById('connect').classList.add('red');
  document.getElementById('connect').classList.remove('disabled', 'green');
  document.getElementById('controller-id').innerHTML = "";
  document.querySelectorAll('.disabled').forEach(el => el.classList.remove('disabled'));
  document.querySelectorAll('.active-connect').forEach(el => el.classList.add('disabled'));
  document.querySelectorAll('.active-ready').forEach(el => el.classList.add('disabled'));
  document.getElementById('controller-status').innerText = '에러';
  document.getElementById('controller-status-color').style.color = 'orangered';
  notyf.error(data);

  if (timer.connect) {
    clearTimeout(timer.connect);
  }
});

/*******************************************************************************
 * UI event handlers
 ******************************************************************************/
function handle_events() {
  document.querySelectorAll('.nav-mode').forEach(elem => {
    elem.addEventListener("click", () => {
      document.querySelectorAll('.nav-mode').forEach(el => el.classList.remove('active'));
      elem.classList.add('active');
      mode = elem.id;

      document.querySelectorAll('.container').forEach(el => el.style.display = 'none');
      document.getElementById(`container-${mode}`).style.display = 'block';
    });
  });

  document.getElementById("connect").addEventListener("click", async () => {
    for (let p of await SerialPort.list()) {
      switch (navigator.platform) {
        case 'Win32': {
          if (p.vendorId === "1999" && p.productId === "0514") {
            controller.device = p;
            ipcRenderer.send('serial-target', controller.device.path);
            document.getElementById('connect').classList.add('disabled');

            timer.connect = setTimeout(() => {
              notyf.error('컨트롤러 연결 실패 (응답 없음)');
              document.getElementById('connect').classList.remove('disabled');
            }, 1000);

            return;
          }
        }

        // NOTE: not tested on other platforms
        default: {
          if (p.vendorId === 0x1999 && p.productId === 0x0514) {
            controller.device = p;
            ipcRenderer.send('serial-target', controller.device.path);
            return;
          }
        }
      }
    }

    notyf.error(`컨트롤러 연결 실패 (장치 없음)`);
  });

  document.querySelectorAll(`.set-sensor`).forEach(elem => {
    elem.addEventListener("click", () => {
      console.log('here?')
      /*************************************************************************
       * protocol $SENSOR: set sensors to use. $READY-ALL on all sensor LSNTP done
       *   request : $SENSOR <%03d sensor count> <...%03d sensor ids>
       *   response: $LSNTP on start, $READY-ALL on finish
       ************************************************************************/
      let cmd;

      switch (mode) {
        // competitive mode; variable lanes
        case 'competitive': {
          let cnt_sensor = document.getElementById('cnt-lane').value;
          active_sensors.competitive = [];

          if (!cnt_sensor) {
            return notyf.error('경기 레인 수를 입력하세요.');
          }

          cnt_sensor = Number(document.getElementById('cnt-lane').value);
          cmd = `${String(cnt_sensor).padStart(3, 0)} `;

          for (let i = 0; i < cnt_sensor; i++) {
            let sensor = document.getElementById(`id-sensor-${i + 1}`).value;

            if (!sensor) {
              return notyf.error(`${i + 1}번 레인 센서 ID를 입력하세요.`);
            } else {
              active_sensors.competitive.push({ id: Number(sensor) });
              cmd += `${String(Number(sensor)).padStart(3, 0)} `;
            }
          }

          cmd = cmd.slice(0, -1);
          break;
        }

        // record mode; start, end sensor
        case 'record': {
          let cnt_sensor = 2;
          let start = document.getElementById(`start-sensor-id`).value;
          let end = document.getElementById(`end-sensor-id`).value;

          if (!start || !end) {
            return notyf.error(`${(!start ? '시작' : '끝')} 지점 센서 ID를 입력하세요.`);
          } else if (Number(start) === Number(end)) {
            return notyf.error(`시작 센서 ID와 끝 센서 ID가 같습니다.`);
          }

          active_sensors.record.start = { id: Number(start) };
          active_sensors.record.end = { id: Number(end) };
          cmd = `${String(cnt_sensor).padStart(3, 0)} ${String(Number(start)).padStart(3, 0)} ${String(Number(end)).padStart(3, 0)}`;
          break;
        }

        default: {
          return;
        }
      }


      elem.classList.add('disabled');
      document.querySelectorAll('.sensor-id').forEach(el => el.classList.add('disabled'));
      ipcRenderer.send('serial-request', `$SENSOR ${cmd}`);

      // TODO: draw sensor UI
    });
  });

  document.querySelectorAll(`.traffic-green`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $GREEN: GREEN ON, RED OFF. mark timestamp
       *   request : $GREEN
       *   response: $START <start timestamp>
       ************************************************************************/
      ipcRenderer.send('serial-request', `$GREEN`);
    });
  });

  document.querySelectorAll(`.traffic-red`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $RED: RED ON, GREEN OFF.
       *   request : $STOP
       *   response: $OK
       ************************************************************************/
      ipcRenderer.send('serial-request', `$RED`);
    });
  });

  document.querySelectorAll(`.traffic-off`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $OFF: RED OFF, GREEN OFF
       *   request : $OFF
       *   response: $OK
       ************************************************************************/
      ipcRenderer.send('serial-request', `$OFF`);
    });
  });
}

handle_events();
