const { ipcRenderer } = require('electron');
const { SerialPort } = require('serialport');
const { Notyf } = require('notyf');

let notyf = new Notyf({ ripple: false, duration: 3500 });

let timer = {
  connect: undefined,
};

const events = ["가속", "스키드패드", "짐카나", "내구"];

// UI mode; record, competitive, lap, settings
let mode = "record";

let controller = {
  device: {},
  id: undefined,
  connected: false,
  time_synced: false,
  start: undefined,
  light: false, // false, green, red
};

let active_sensors = {
  competitive: [],
  record: {
    start: null,
    end: null,
  },
  lap: undefined
};

/*******************************************************************************
 * serial port open handler                                                    *
 ******************************************************************************/
ipcRenderer.on('serial-open', (evt, data) => {
  /*************************************************************************
   * protocol $HELLO: greetings!
   *   request : $HELLO
   *   response: $HI <%03d controller id>
   ************************************************************************/
  ipcRenderer.send('serial-request', '$HELLO');
});

/*******************************************************************************
 * serial data handler                                                         *
 ******************************************************************************/
ipcRenderer.on('serial-data', (evt, data) => {
  let rcv = String.fromCharCode(...data.data);
  console.log(rcv);

  rcv = rcv.match(/\$[^$]+/g);

  // no protocol message found
  if (!rcv) {
    return;
  }

  // handle all protocol messages
  for (let str of rcv) {
    /*************************************************************************
     * protocol $HELLO: greetings!
     *   request : $HELLO
     *   response: $HI <%03d my id>
     ************************************************************************/
    if (str.includes("$HI")) {
      controller.id = Number(str.substr(4, 3));
      controller.connected = true;
      document.querySelector(`div#container-${mode} .connect`).classList.remove('red');
      document.querySelector(`div#container-${mode} .connect`).classList.add('green');
      document.querySelector(`div#container-${mode} .controller-id`).innerHTML = `<i class="fa fw fa-hashtag"></i>${controller.id}`;
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '연결됨';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'green';
      document.querySelectorAll('.active-connect').forEach(el => el.classList.remove('disabled'));
      notyf.success(`${controller.id}번 컨트롤러 연결 완료 (${controller.device.path})`);

      if (timer.connect) {
        clearTimeout(timer.connect);
      }
    }

    /*************************************************************************
     * protocol $SENSOR: set sensors to use. $READY-ALL on all sensor LSNTP done
     *   request : $SENSOR <%03d sensor count> <...%03d sensor ids>
     *   response: $LSNTP on start, $READY-ALL on finish
     ************************************************************************/
    else if (str.includes("$LSNTP")) {
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '센서 시간 동기화 중... 센서 전원을 켜세요.';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'cornflowerblue';
      notyf.success('센서 시간 동기화 중...');
    }

    else if (str.includes("$READY-ALL")) {
      controller.time_synced = true;
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '계측 대기';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'green';
      document.querySelectorAll('.active-ready').forEach(el => el.classList.remove('disabled'));
      notyf.success('센서 시간 동기화 완료 / 계측 대기');
    }

    /*************************************************************
     * protocol $READY: notify sensor ready
     *   notify: $READY <%03d sensor id> <%d sensor offset>
     ************************************************************/
    else if (str.includes("$READY ")) {
      const id = Number(str.substr(7, 3));
      const offset = Number(str.substr(10));

      document.querySelectorAll(`div#container-${mode} input.sensor-id`).forEach(el => {
        if (id === Number(el.value.trim())) {
          el.parentElement.nextElementSibling.innerText = `(${offset} ms)`;
        }
      });

      notyf.success(`${id}번 센서 시간 오프셋: ${offset} ms`);
    }

    /*************************************************************
     * protocol $REPORT: notify sensor report
     *   notify: $REPORT <%03d sensor id> <%d timestamp>
     ************************************************************/
    else if (str.includes("$REPORT")) {
      // TODO
    }

    /*************************************************************************
     * protocol $GREEN: GREEN ON, RED OFF. mark timestamp
     *   request : $GREEN
     *   response: $START <start timestamp>
     ************************************************************************/
    else if (str.includes("$START")) {
      controller.start = new Date();
      controller.light = "green";
      document.querySelector(`div#container-${mode} .traffic`).style["background-color"] = 'green';
      document.querySelector(`div#container-${mode} .traffic-green`).classList.add('disabled');
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '계측 중...';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'purple';
      document.querySelector(`div#container-${mode} .event-name`).classList.add('disabled');
      document.querySelectorAll(`div#container-${mode} select.select-team`).forEach(el => el.classList.add('disabled'));
      notyf.success('계측 시작');
    }

    /*************************************************************************
     * protocol $RED: RED ON, GREEN OFF.
     *   request : $RED
     *   response: $OK-RED
     ************************************************************************/
    /*************************************************************************
     * protocol $OFF: RED OFF, GREEN OFF
     *   request : $OFF
     *   response: $OK-OFF
     ************************************************************************/
    else if (str.includes("$OK-RED") || str.includes("$OK-OFF")) {
      document.querySelector(`div#container-${mode} .traffic`).style["background-color"] = str.includes("$OK-RED") ? "rgb(230, 20, 20)" : "grey";
      document.querySelector(`div#container-${mode} .traffic-green`).classList.remove('disabled');
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '계측 대기';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'green';
      document.querySelector(`div#container-${mode} .event-name`).classList.remove('disabled');
      document.querySelectorAll(`div#container-${mode} select.select-team`).forEach(el => el.classList.remove('disabled'));

      if (controller.light === "green") {
        notyf.success('계측 종료');
      }

      controller.light = str.includes("$OK-RED") ? "red" : false;
    }
  }
});

/*******************************************************************************
 * serial failure handler                                                      *
 ******************************************************************************/
ipcRenderer.on('serial-error', (evt, data) => {
  document.querySelector(`.connect`).classList.add('red');
  document.querySelector(`.connect`).classList.remove('disabled', 'green');
  document.querySelector(`.controller-id`).innerHTML = "";

  if (data === "컨트롤러 연결 해제") {
    document.querySelector(`.controller-status`).innerText = "연결 대기";
    document.querySelector(`.controller-status-color`).style.color = 'orange';
  } else {
    document.querySelector(`.controller-status`).innerText = "오류 발생";
    document.querySelector(`.controller-status-color`).style.color = 'orangered';
  }
  document.querySelectorAll('.disabled').forEach(el => el.classList.remove('disabled'));
  document.querySelectorAll('.active-connect').forEach(el => el.classList.add('disabled'));
  document.querySelectorAll('.active-ready').forEach(el => el.classList.add('disabled'));
  notyf.error(data);

  if (timer.connect) {
    clearTimeout(timer.connect);
  }
});

/*******************************************************************************
 * UI event handlers                                                           *
 ******************************************************************************/
async function handle_events() {
  await refresh_entries();
  document.querySelectorAll('select.select-team').forEach(el => el.innerHTML = template_team_select());

  /* navigation sidebar handler ***********************************************/
  document.querySelectorAll('.nav-mode').forEach(elem => {
    elem.addEventListener("click", () => {
      document.querySelectorAll('.nav-mode').forEach(el => el.classList.remove('active'));
      elem.classList.add('active');
      mode = elem.id;

      document.querySelectorAll('.container').forEach(el => el.style.display = 'none');
      document.getElementById(`container-${mode}`).style.display = 'flex';
    });
  });

  /* title handler ************************************************************/
  document.querySelectorAll(`input.event-name`).forEach(el => {
    el.addEventListener("keyup", () => {
      document.getElementById(`${mode}-title`).innerText = `${new Date().getFullYear()} FSK ${el.value.trim()}`;
    });
  });

  /* controller connection handler ********************************************/
  document.querySelectorAll(".connect").forEach(elem => {
    elem.addEventListener("click", async () => {
      for (let p of await SerialPort.list()) {
        switch (navigator.platform) {
          case 'Win32': {
            if (p.vendorId === "1999" && p.productId === "0514") {
              controller.device = p;
              ipcRenderer.send('serial-target', controller.device.path);
              document.querySelectorAll(`.connect`).forEach(el => el.classList.add('disabled'));

              timer.connect = setTimeout(() => {
                notyf.error('컨트롤러 연결 실패 (응답 없음)');
                document.querySelectorAll(`.connect`).forEach(el => el.classList.remove('disabled'));
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
  });

  /* reset controller handler *************************************************/
  document.querySelectorAll(`.reset`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $RESET: see you again!
       *   request : $RESET
       *   response: -
       ************************************************************************/
      ipcRenderer.send('serial-request', `$RESET`);
    });
  });

  /* sensor configuration handler *********************************************/
  document.querySelectorAll(`.set-sensor`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $SENSOR: set sensors to use. $READY-ALL on all sensor LSNTP done
       *   request : $SENSOR <%03d sensor count> <...%03d sensor ids>
       *   response: $LSNTP on start, $READY-ALL on finish
       ************************************************************************/
      let cmd;

      switch (mode) {
        case 'record': {
          let cnt_sensor = 2;
          let start = document.getElementById(`start-sensor-id`).value.trim();
          let end = document.getElementById(`end-sensor-id`).value.trim();

          if (!start || !end) {
            return notyf.error(`${(!start ? '시작' : '끝')} 지점 센서 ID를 입력하세요.`);
          } else if (Number(start) === Number(end)) {
            return notyf.error(`시작 지점 센서 ID와 끝 지점 센서 ID가 같습니다.`);
          } else if (Number(start) < 1 || Number(end) > 200) {
            return notyf.error(`시작 지점 센서 ID가 유효하지 않습니다. 센서 ID 범위는 1 ~ 200 입니다.`);
          } else if (Number(end) < 1 || Number(end) > 200) {
            return notyf.error(`끝 지점 센서 ID가 유효하지 않습니다. 센서 ID 범위는 1 ~ 200 입니다.`);
          }

          active_sensors.record.start = { id: Number(start) };
          active_sensors.record.end = { id: Number(end) };
          cmd = `${String(cnt_sensor).padStart(3, 0)} ${String(Number(start)).padStart(3, 0)} ${String(Number(end)).padStart(3, 0)}`;
          break;
        }

        case 'competitive': {
          let cnt_sensor = Number(document.getElementById('cnt-lane').value.trim());
          cmd = `${String(cnt_sensor).padStart(3, 0)} `;

          active_sensors.competitive = [];

          for (let i = 0; i < cnt_sensor; i++) {
            let sensor = document.getElementById(`sensor-id-lane-${i + 1}`).value.trim();

            if (!sensor) {
              return notyf.error(`${i + 1}번 레인의 센서 ID를 입력하세요.`);
            } else if (Number(sensor) < 1 || Number(sensor) > 200) {
              return notyf.error(`${i + 1}번 레인의 센서 ID가 유효하지 않습니다. 센서 ID 범위는 1 ~ 200 입니다.`);
            } else {
              active_sensors.competitive.push({ id: Number(sensor) });
              cmd += `${String(Number(sensor)).padStart(3, 0)} `;
            }
          }

          cmd = cmd.slice(0, -1);
          break;
        }

        case 'lap': {
          let cnt_sensor = 1;
          let sensor = document.getElementById('lap-sensor-id').value.trim();

          if (!sensor) {
            return notyf.error(`센서 ID를 입력하세요.`);
          } else if (Number(sensor) < 1 || Number(sensor) > 200) {
            return notyf.error(`센서 ID가 유효하지 않습니다. 센서 ID 범위는 1 ~ 200 입니다.`);
          }

          active_sensors.lap = { id: Number(sensor) };
          cmd = `${String(cnt_sensor).padStart(3, 0)} ${String(Number(sensor)).padStart(3, 0)}`;
          break;
        }

        default: {
          return;
        }
      }

      elem.classList.add('disabled');
      document.querySelectorAll('.sensor-id').forEach(el => el.classList.add('disabled'));
      ipcRenderer.send('serial-request', `$SENSOR ${cmd}`);
    });
  });

  /* team selection handler ***************************************************/
  document.addEventListener("change", e => {
    if (!e.target.matches("select.select-team")) {
      return;
    }

    let entry = entries.find(x => x.number === e.target.value);

    if (!entry) {
      return notyf.error("선택한 팀을 엔트리에서 찾을 수 없습니다.");
    }

    switch (mode) {
      case 'record': {
        document.querySelector(`div#container-${mode} .entry-team`).innerText = `${entry.number} ${entry.univ} ${entry.team}`;
        document.querySelector(`div#container-${mode} .entry-team-time`).innerText = "RECORD 00:00:00.000";
        document.querySelector(`div#container-${mode} .entry-team-hidden`).innerText = JSON.stringify(entry);
        break;
      }

      case 'competitive': {
        let teams = [...document.querySelectorAll(`div#container-${mode} select.select-team`)].map(el => el.value);

        if (teams.filter(x => x === entry.number).length > 1) {
          e.target.options[0].selected = true;
          return notyf.error("이미 다른 레인에 선택된 팀입니다.");
        }

        let lane = Number(e.target.id.replace('team-lane-', ''));
        document.getElementById(`entry-lane-${lane}`).innerHTML = `<i class="fa fw fa-${lane}"></i>`;
        document.getElementById(`entry-team-${lane}`).innerText = `${entry.number} ${entry.univ} ${entry.team}`;
        document.getElementById(`entry-team-time-${lane}`).innerText = "RECORD 00:00:00.000";
        document.getElementById(`entry-team-hidden-${lane}`).innerText = JSON.stringify(entry);
        break;
      }

      case 'lap': {

        break;
      }

      default: {
        return;
      }
    }
  });

  /* competitive mode lane count handler **************************************/
  document.getElementById("cnt-lane").addEventListener("keyup", () => {
    let cnt = document.getElementById("cnt-lane").value.trim();

    cnt = cnt ? Number(cnt) : 0;

    if (cnt < 1 || cnt > 9) {
      return notyf.error('레인 개수 범위는 1 ~ 9 개입니다.');
    }

    // back up previous values
    let sensor_prev = [...document.querySelectorAll(`#competitive-sensor-table input.sensor-id`)].map(el => el.value);
    let team_prev = [...document.querySelectorAll(`#competitive-team-table select.select-team`)].map(el => el.value);

    let sensor_html = "";
    let team_html = "";
    let monitor_html = "";

    for (let i = 1; i <= cnt; i++) {
      sensor_html += template_sensor_tr(i, sensor_prev[i - 1] ? sensor_prev[i - 1] : "");
      team_html += template_team_tr(i, team_prev[i - 1] ? team_prev[i - 1] : "");
      monitor_html += template_monitor_tr(i, team_prev[i - 1] ? team_prev[i - 1] : "");
    }

    document.getElementById("competitive-sensor-table").innerHTML = sensor_html;
    document.getElementById("competitive-team-table").innerHTML = team_html;
    document.getElementById("competitive-team-list").innerHTML = monitor_html;
  });

  /* traffic green light handler **********************************************/
  document.querySelectorAll(`.traffic-green`).forEach(elem => {
    elem.addEventListener("click", () => {
      if (!document.querySelector(`div#container-${mode} input.event-name`).value.trim()) {
        return notyf.error('이벤트 이름을 입력하세요.');
      }

      let cnt = 0;

      if (mode === 'record' || mode === 'competitive') {
        for (let team of document.querySelectorAll(`div#container-${mode} select.select-team`)) {
          if (team.value !== "팀 선택") {
            cnt++;
          }
        }

        if (cnt === 0) {
          return notyf.error('참가팀을 선택하세요.');
        }
      }

      /*************************************************************************
       * protocol $GREEN: GREEN ON, RED OFF. mark timestamp
       *   request : $GREEN
       *   response: $START <start timestamp>
       ************************************************************************/
      ipcRenderer.send('serial-request', `$GREEN`);
    });
  });

  /* traffic red light handler ************************************************/
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

  /* traffic light off handler ************************************************/
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

/*******************************************************************************
 * utility functions                                                           *
 ******************************************************************************/
let entries = undefined;

async function refresh_entries() {
  try {
    entries = await ipcRenderer.invoke('read-entry');
  } catch (e) {
    notyf.error(`엔트리 파일이 손상되었습니다.<br>${e.message}`);
    document.querySelectorAll(`nav, div.container`).forEach(el => el.classList.add("disabled"));
  }
}

function template_team_select(value) {
  let html = "<option selected disabled>팀 선택</option>";

  for (let entry of entries) {
    html += `<option value='${entry.number}' ${entry.number == value ? "selected" : ""}>${entry.number} ${entry.univ} ${entry.team}</option>`;
  }

  return html;
}

function template_sensor_tr(num, value) {
  return `
    <tr>
      <td>
        <i class="fa fw fa-${num}"></i>
      </td>
      <td><input type="number" id="sensor-id-lane-${num}" class="sensor-id" placeholder="센서 ID" value=${value}></td>
      <td id="sensor-offset-lane-${num}" style="padding-left: 1rem;"></td>
    </tr>`;
}

function template_team_tr(num, value) {
  return `
    <tr>
      <td>
        <i class="fa fw fa-${num}"></i>
      </td>
      <td>
        <select id="team-lane-${num}" class='select-team'>
          ${template_team_select(value)}
        </select>
      </td>
    </tr>`;
}

function template_monitor_tr(num, value) {
  let entry = entries.find(x => x.number == value);

  return `
    <tr>
      <td id="entry-lane-${num}" class="entry-team">${entry ? `<i class="fa fw fa-${num}"></i>` : '‎'}</td>
      <td>
        <div id="entry-team-${num}" class="entry-team">${entry ? `${entry.number} ${entry.univ} ${entry.team}` : '‎'}</div>
        <div id="entry-team-time-${num}" class="entry-team-time">${entry ? 'RECORD 00:00:00.000' : '‎'}</div>
        <div id="entry-team-hidden-${num}" class="entry-team-hidden">${entry ? JSON.stringify(entry) : '‎'}</div>
      </td>
    </tr>`;
}
