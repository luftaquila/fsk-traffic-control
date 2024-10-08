const { event } = window.__TAURI__;
const { invoke } = window.__TAURI__.tauri;

let notyf = new Notyf({ ripple: false, duration: 3500 });

let timer = {
  connect: undefined,
  clock: undefined,
  record: undefined,
  competitive: [],
};

let timestamps = {
  record: {
    start: undefined,
    end: undefined,
  },
  competitive: [],
  lap: undefined
};

// UI mode; record, competitive, lap, settings
let mode = "record";

let controller = {
  device: undefined,
  id: undefined,
  connected: false,
  time_synced: false,
  start: undefined,
  start_ts: undefined,
  running: false,
  light: false, // false, green, red
};

let active_sensors = {
  record: {
    start: null,
    end: null,
  },
  competitive: [],
  lap: undefined,
};

let lap_cnt = 0;
let record_delay = undefined;

window.addEventListener("DOMContentLoaded", async () => {
  setup();
});

/*******************************************************************************
 * serial data handler                                                         *
 ******************************************************************************/
event.listen('serial-data', async event => {
  let rcv = event.payload;
  console.log(`${Number(new Date())} ${rcv}`);

  rcv = rcv.match(/\$[^$]+!/g).map(x => x.slice(0, -1));

  // no protocol message found
  if (!rcv) {
    return;
  }

  // handle all protocol messages
  for (let str of rcv) {
    // back up to the fsk-log.json
    await invoke('append_file', {
      name: "fsk-log.json",
      data: JSON.stringify({
        date: new Date(),
        data: str,
      }, null, 2) + '\n'
    });

    if (str.includes("$ERROR")) {
      notyf.error(`컨트롤러 프로토콜 오류<br>컨트롤러 전원을 껐다 켠 후 다시 시도하세요.`);
    }

    /*************************************************************************
     * protocol $HELLO: greetings!
     *   request : $HELLO
     *   response: $HI <%03d my id>
     ************************************************************************/
    else if (str.includes("$HI")) {
      controller.id = Number(str.substr(4, 3));
      controller.connected = true;
      document.querySelectorAll(`.connect`).forEach(el => el.classList.add('disabled'));
      document.querySelector(`div#container-${mode} .connect`).classList.remove('red');
      document.querySelector(`div#container-${mode} .connect`).classList.add('green');
      document.querySelector(`div#container-${mode} .controller-id`).innerHTML = `<i class="fa fw fa-hashtag"></i>${controller.id}`;
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '연결됨';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'green';
      document.querySelectorAll(`div#container-${mode} .active-connect`).forEach(el => el.classList.remove('disabled'));
      document.querySelectorAll('.traffic').forEach(el => el.style["background-color"] = "grey");
      document.querySelectorAll('.clock').forEach(el => el.innerText = "00:00:00.000");

      notyf.success(`${controller.id}번 컨트롤러 연결 완료 (${controller.device})`);

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
      const id = Number(str.substr(8, 3));
      const ts = Number(str.substr(11));

      if (!controller.running) {
        return;
      }

      switch (mode) {
        case 'record': {
          controller.start = new Date();

          if (id === active_sensors.record.start.id) {
            if (timestamps.record.start) {
              return notyf.error(`출발점 센서가 알 수 없는 물체를 검출했습니다.<br>센서 리포트를 무시합니다.<br>${str}`);
            }

            timestamps.record.start = ts;
            record_delay = timestamps.record.start - controller.start_ts;

            timer.clock = setInterval(() => {
              document.querySelector(`div#container-${mode} .clock`).innerText = ms_to_clock(new Date() - controller.start);
            }, 7);

            let clock = document.querySelector(`div#container-${mode} .entry-team-time`);
            clock.innerText = '+' + ms_to_clock(record_delay);
            clock.classList.add('blink');
            setTimeout(() => { clock.classList.remove('blink'); }, 3000);

            notyf.success("출발점 센서가 차량 출발을 검출했습니다.");
          }

          else if (id === active_sensors.record.end.id) {
            if (timestamps.record.end) {
              return notyf.error(`도착점 센서가 알 수 없는 물체를 검출했습니다.<br>센서 리포트를 무시합니다.<br>${str}`);
            }

            if (!timestamps.record.start) {
              return notyf.error(`도착점 센서가 출발점 센서보다 먼저 물체를 검출했습니다.<br>센서 리포트를 무시합니다.<br>${str}`);
            }

            timestamps.record.end = ts;
            let result = timestamps.record.end - timestamps.record.start;
            clearInterval(timer.clock);

            // set clock
            let clock = document.querySelector(`div#container-${mode} .clock`);
            clock.innerText = ms_to_clock(result);
            clock.classList.add('blink');
            setTimeout(() => { clock.classList.remove('blink'); }, 3000);

            // save result to the file
            let number = document.querySelector(`div#container-${mode} select.select-team`).value;
            let entry = entries.find(x => x.number === number);

            if (!entry) {
              notyf.error("주행한 팀을 엔트리에서 찾을 수 없습니다.<br>파일에 UNKNOWN으로 기록됩니다.");
              entry = {
                number: "UNKNOWN",
                univ: "UNKNOWN",
                team: "UNKNOWN",
              };
            }

            try {
              let file = await invoke('append_file', {
                name: document.querySelector(`div#container-${mode} .event-name`).value.trim(),
                data: JSON.stringify({
                  time: new Date(),
                  type: "record",
                  lane: "N/A",
                  entry: {
                    number: entry.number,
                    univ: entry.univ,
                    team: entry.team,
                  },
                  result: {
                    ms: result,
                    delay: record_delay,
                  },
                }, null, 2) + '\n',
              });
              notyf.success(`도착점 센서가 차량을 검출했습니다.<br>${file} 파일에 기록이 저장되었습니다.`);
            } catch (e) {
              notyf.error(`도착점 센서가 차량을 검출했으나 결과를 파일에 저장하는데 실패했습니다.<br>${e.message}`);
            }
          }

          else {
            return notyf.error(`센서 리포트가 손상되었습니다.<br>${str}`);
          }

          break;
        }

        case 'competitive': {
          let sensor = active_sensors.competitive.find(x => x.id === id);

          if (!sensor) {
            return notyf.error(`센서 리포트가 손상되었습니다.<br>${str}`);
          }

          if (timestamps.competitive[sensor.lane]) {
            return notyf.error(`${sensor.lane}번 레인 센서가 알 수 없는 물체를 검출했습니다.<br>센서 리포트를 무시합니다.<br>${str}`);
          }

          timestamps.competitive[sensor.lane] = ts;
          let result = timestamps.competitive[sensor.lane] - controller.start_ts;

          let clock = document.getElementById(`entry-team-time-${sensor.lane}`);
          clock.innerText = `RECORD ${ms_to_clock(result)}`;
          clock.classList.add('blink');
          setTimeout(() => { clock.classList.remove('blink'); }, 3000);

          // save result to the file
          let number = document.getElementById(`team-lane-${sensor.lane}`).value;
          let entry = entries.find(x => x.number === number);

          if (!entry) {
            notyf.error("주행한 팀을 엔트리에서 찾을 수 없습니다.<br>파일에 UNKNOWN으로 기록됩니다.");
            entry = {
              number: "UNKNOWN",
              univ: "UNKNOWN",
              team: "UNKNOWN",
            };
          }

          try {
            let file = await invoke('append_file', {
              name: document.querySelector(`div#container-${mode} .event-name`).value.trim(),
              data: JSON.stringify({
                time: new Date(),
                type: "competitive",
                lane: sensor.lane,
                entry: {
                  number: entry.number,
                  univ: entry.univ,
                  team: entry.team,
                },
                result: {
                  ms: result,
                },
              }, null, 2) + '\n',
            });
            notyf.success(`${sensor.lane}번 레인 센서가 차량을 검출했습니다.<br>${file} 파일에 기록이 저장되었습니다.`);
          } catch (e) {
            notyf.error(`${sensor.lane}번 레인 센서가 차량을 검출했으나 결과를 파일에 저장하는데 실패했습니다.<br>${e.message}`);
          }
          break;
        }

        case 'lap': {
          if (active_sensors.lap.id !== id) {
            return notyf.error(`센서 리포트가 손상되었습니다.<br>${str}`);
          }

          let abs = ts - controller.start_ts;
          let diff = timestamps.lap ? ts - timestamps.lap : ts - controller.start_ts;
          timestamps.lap = ts;
          lap_cnt++;

          document.getElementById('lap-log').innerHTML += `${String(lap_cnt).padStart(3, ' ').replace(/ /g, '&nbsp')}&emsp;${ms_to_clock(abs)} <span style="font-size: 1.2rem">(+${ms_to_clock(diff)})</span><br>`;

          // save result to the file
          try {
            let file = await invoke('append_file', {
              name: document.querySelector(`div#container-${mode} .event-name`).value.trim(),
              data: JSON.stringify({
                time: new Date(),
                type: "lap",
                lane: "N/A",
                entry: {
                  number: "N/A",
                  univ: "N/A",
                  team: "N/A",
                },
                result: {
                  ms: abs,
                  diff: diff,
                  rank: lap_cnt,
                },
              }, null, 2) + '\n',
            });
            notyf.success(`센서가 차량을 검출했습니다.<br>${file} 파일에 기록이 저장되었습니다.`);
          } catch (e) {
            notyf.error(`센서가 차량을 검출했으나 결과를 파일에 저장하는데 실패했습니다.<br>${e.message}`);
          }
          break;
        }
      }
    }

    /*************************************************************************
     * protocol $GREEN: GREEN ON, RED OFF. mark timestamp
     *   request : $GREEN
     *   response: $START <start timestamp>
     ************************************************************************/
    else if (str.includes("$START")) {
      controller.start = new Date();
      controller.start_ts = Number(str.substr(7));

      controller.running = true;
      controller.light = "green";

      document.querySelector('nav').classList.add('disabled');
      document.querySelector(`div#container-${mode} .reset`).classList.add('disabled');
      document.querySelector(`div#container-${mode} .traffic-green`).classList.add('disabled');
      document.querySelectorAll(`div#container-${mode} select.select-team`).forEach(el => el.classList.add('disabled'));
      document.querySelectorAll(`div#container-${mode} button.deselect-team`).forEach(el => el.classList.add('disabled'));

      document.querySelector(`div#container-${mode} .traffic`).style["background-color"] = 'green';
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '계측 중...';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'purple';
      document.querySelector(`div#container-${mode} .event-name`).classList.add('disabled');

      if (mode === 'competitive' || mode === 'lap') {
        timer.clock = setInterval(() => {
          document.querySelector(`div#container-${mode} .clock`).innerText = ms_to_clock(new Date() - controller.start);
        }, 7);
      }

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
      controller.running = false;
      controller.light = str.includes("$OK-RED") ? "red" : false;

      if (timer.clock) {
        clearInterval(timer.clock);
      }

      document.querySelector('nav').classList.remove('disabled');
      document.querySelector(`div#container-${mode} .reset`).classList.remove('disabled');
      document.querySelector(`div#container-${mode} .traffic-green`).classList.remove('disabled');
      document.querySelector(`div#container-${mode} .event-name`).classList.remove('disabled');
      document.querySelectorAll(`div#container-${mode} select.select-team`).forEach(el => el.classList.remove('disabled'));
      document.querySelectorAll(`div#container-${mode} button.deselect-team`).forEach(el => el.classList.remove('disabled'));

      document.querySelector(`div#container-${mode} .traffic`).style["background-color"] = str.includes("$OK-RED") ? "rgb(230, 20, 20)" : "grey";
      document.querySelector(`div#container-${mode} .controller-status`).innerText = '계측 대기';
      document.querySelector(`div#container-${mode} .controller-status-color`).style.color = 'green';
      document.querySelectorAll(`div#container-${mode} .blink`).forEach(el => el.classList.remove('blink'));

      if (str.includes("$OK-OFF")) {
        document.querySelectorAll('.clock').forEach(el => el.innerText = "00:00:00.000");

        switch (mode) {
          case 'record':
            document.querySelector(`div#container-${mode} select.select-team`).dispatchEvent(new Event("change", { bubbles: true }));
            break;

          case 'competitive':
            document.querySelectorAll(`div#container-${mode} select.select-team`).forEach(el => el.dispatchEvent(new Event("change", { bubbles: true })));
            break;

          case 'lap':
            document.getElementById('lap-log').innerHTML = "";
            lap_cnt = 0;
            break;
        }
      }

      // reset all timestamps
      timestamps = {
        record: {
          start: undefined,
          end: undefined,
        },
        competitive: [],
        lap: undefined
      };

      if (controller.light === "green") {
        notyf.success('계측 종료');
      }
    }
  }
});

/*******************************************************************************
 * serial failure handler                                                      *
 ******************************************************************************/
event.listen('serial-error', async event => {
  let data = event.payload;
  controller.running = false;
  controller.connected = false;
  controller.device = undefined;

  document.querySelectorAll(`.connect`).forEach(el => el.classList.add('red'));
  document.querySelectorAll(`.connect`).forEach(el => el.classList.remove('disabled', 'green'));
  document.querySelectorAll(`.controller-id`).forEach(el => el.innerHTML = "");
  document.querySelectorAll(`.controller-status`).forEach(el => el.innerText = "오류 발생");
  document.querySelectorAll(`.controller-status-color`).forEach(el => el.style.color = 'orangered');
  document.querySelectorAll('.disabled').forEach(el => el.classList.remove('disabled'));
  document.querySelectorAll('.active-connect').forEach(el => el.classList.add('disabled'));
  document.querySelectorAll('.active-ready').forEach(el => el.classList.add('disabled'));

  document.querySelectorAll('.sensor-offset').forEach(el => el.innerHTML = "");
  document.querySelectorAll('.clock').forEach(el => el.innerHTML = "00:00:00.000");

  console.error(data);
  notyf.error(data);

  if (timer.connect) {
    clearTimeout(timer.connect);
  }

  if (timer.clock) {
    clearInterval(timer.clock);
  }
});

/*******************************************************************************
 * UI drawers and event handlers                                                           *
 ******************************************************************************/
async function setup() {
  // set team select options and entry table
  await refresh_entries();
  document.querySelectorAll('select.select-team').forEach(el => el.innerHTML = template_team_select());
  setup_entry();
  setup_log_viewer();

  /* navigation sidebar handler ***********************************************/
  document.querySelectorAll('.nav-mode').forEach(elem => {
    elem.addEventListener("click", () => {
      document.querySelectorAll('.nav-mode').forEach(el => el.classList.remove('active'));
      elem.classList.add('active');
      mode = elem.id;

      document.querySelectorAll('.container').forEach(el => el.style.display = 'none');
      document.getElementById(`container-${mode}`).style.display = 'flex';

      if (mode === "log") {
        update_log_viewer();
      }
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
      try {
        controller.device = await invoke('serial_connect');
        invoke('serial_request', { data: "$HELLO" });
      } catch (e) {
        notyf.error(`컨트롤러 연결에 실패했습니다.<br>${e}`);
      }
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
      invoke('serial_request', { data: `$RESET` });
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
            return notyf.error(`${(!start ? '출발' : '도착')}점 센서 ID를 입력하세요.`);
          } else if (Number(start) === Number(end)) {
            return notyf.error(`출발점 센서 ID와 도착점 센서 ID가 같습니다.`);
          } else if (Number(start) < 1 || Number(end) > 200) {
            return notyf.error(`출발점 센서 ID가 유효하지 않습니다.<br>센서 ID 범위는 1 ~ 200 입니다.`);
          } else if (Number(end) < 1 || Number(end) > 200) {
            return notyf.error(`도착점 센서 ID가 유효하지 않습니다.<br>센서 ID 범위는 1 ~ 200 입니다.`);
          }

          active_sensors.record.start = { id: Number(start) };
          active_sensors.record.end = { id: Number(end) };
          cmd = `${String(cnt_sensor).padStart(3, 0)} ${String(Number(start)).padStart(3, 0)} ${String(Number(end)).padStart(3, 0)}`;
          break;
        }

        case 'competitive': {
          let cnt_sensor = Number(document.getElementById('cnt-lane').value);
          cmd = `${String(cnt_sensor).padStart(3, 0)} `;

          active_sensors.competitive = [];

          for (let i = 0; i < cnt_sensor; i++) {
            let sensor = document.getElementById(`sensor-id-lane-${i + 1}`).value.trim();

            if (!sensor) {
              return notyf.error(`${i + 1}번 레인의 센서 ID를 입력하세요.`);
            } else if (Number(sensor) < 1 || Number(sensor) > 200) {
              return notyf.error(`${i + 1}번 레인의 센서 ID가 유효하지 않습니다.<br>센서 ID 범위는 1 ~ 200 입니다.`);
            } else {
              active_sensors.competitive.push({ id: Number(sensor), lane: i + 1 });
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
            return notyf.error(`센서 ID가 유효하지 않습니다.<br>센서 ID 범위는 1 ~ 200 입니다.`);
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
      invoke('serial_request', { data: `$SENSOR ${cmd}` });
    });
  });

  /* dynamic DOM event handler ************************************************/
  document.addEventListener("click", e => {
    /* team deselection handler ***********************************************/
    let button = e.target.closest("button.deselect-team");

    if (button) {
      button.previousElementSibling.options[0].selected = true;
      button.previousElementSibling.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  document.addEventListener("change", e => {
    /* team selection handler *************************************************/
    if (e.target.matches("select.select-team")) {
      let deselect = false;

      if (e.target.value === "팀 선택") {
        deselect = true;
      }

      let entry = entries.find(x => x.number === e.target.value);

      if (!entry && !deselect) {
        return notyf.error("선택한 팀을 엔트리에서 찾을 수 없습니다.");
      }

      let mode = e.target.closest('div.container').id.replace("container-", "");

      switch (mode) {
        case 'record': {
          document.querySelector(`div#container-${mode} .entry-team`).innerText = deselect ? '‎' : `${entry.number} ${entry.univ} ${entry.team}`;
          document.querySelector(`div#container-${mode} .entry-team-time`).innerText = deselect ? '‎' : "+00:00:00.000";
          break;
        }

        case 'competitive': {
          let teams = [...document.querySelectorAll(`div#container-${mode} select.select-team`)].map(el => el.value);

          if (!deselect && teams.filter(x => x === entry.number).length > 1) {
            e.target.options[0].selected = true;
            deselect = true;
            notyf.error("이미 다른 레인에 선택된 팀입니다.");
          }

          let lane = Number(e.target.id.replace('team-lane-', ''));
          document.getElementById(`entry-lane-${lane}`).innerHTML = deselect ? '‎' : `<i class="fa fw fa-${lane}"></i>`;
          document.getElementById(`entry-team-${lane}`).innerText = deselect ? '‎' : `${entry.number} ${entry.univ} ${entry.team}`;
          document.getElementById(`entry-team-time-${lane}`).innerText = deselect ? '‎' : "RECORD 00:00:00.000";
          break;
        }
      }
    }
  });

  /* competitive mode lane count handler **************************************/
  document.getElementById("cnt-lane").addEventListener("change", () => {
    let cnt = Number(document.getElementById("cnt-lane").value);

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

    document.getElementById("cnt-lane-text").innerText = cnt;
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
      invoke('serial_request', { data: `$GREEN` });
    });
  });

  /* traffic red light handler ************************************************/
  document.querySelectorAll(`.traffic-red`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $RED: RED ON, GREEN OFF.
       *   request : $STOP
       *   response: $OK-RED
       ************************************************************************/
      invoke('serial_request', { data: `$RED` });
    });
  });

  /* traffic light off handler ************************************************/
  document.querySelectorAll(`.traffic-off`).forEach(elem => {
    elem.addEventListener("click", () => {
      /*************************************************************************
       * protocol $OFF: RED OFF, GREEN OFF
       *   request : $OFF
       *   response: $OK-OFF
       ************************************************************************/
      invoke('serial_request', { data: `$OFF` });
    });
  });

  /* entry list handler *******************************************************/
  document.getElementById("entry-add").addEventListener("click", async () => {
    let entry = document.getElementById("entry-add-number").value.trim();
    let univ = document.getElementById("entry-add-univ").value.trim();
    let team = document.getElementById("entry-add-team").value.trim();

    if (!entry || !univ || !team) {
      return notyf.error("추가할 엔트리 정보에 누락된 값이 있습니다.");
    }

    if (entries.find(x => Number(x.number) === Number(entry))) {
      return notyf.error("이미 존재하는 엔트리 번호입니다.");
    }

    entry_table.rows.add([entry, univ, team, '']);
    entry_table.columns.sort(0, "asc");

    update_entry_table("엔트리가 추가되었습니다.", "엔트리를 추가하지 못했습니다.");

    document.getElementById("entry-add-number").value = "";
    document.getElementById("entry-add-univ").value = "";
    document.getElementById("entry-add-team").value = "";
    document.getElementById("entry-add-number").focus();
  });
}

let entry_table = undefined;

function setup_entry() {
  entry_table = new simpleDatatables.DataTable("#entry-table", {
    columns: [
      { select: 0, sort: "asc" },
      { select: 1 },
      { select: 2 },
      {
        select: 3, sortable: false, type: "string", render: (value, td, row, cell) => {
          return `<span class="delete-entry btn red small" onclick="delete_entry(${row})"><i class="fa fw fa-delete-left"></i>삭제</span>`;
        }
      },
    ],
    data: {
      headings: [
        {
          text: "엔트리",
          data: "number"
        }, {
          text: "학교",
          data: "univ"
        }, {
          text: "팀",
          data: "team"
        }, {
          text: "삭제",
          data: "del"
        }
      ],
    },
    perPage: 100,
    perPageSelect: [10, 20, 50, 100],
  });

  simpleDatatables.makeEditable(entry_table, { contextMenu: false });

  entry_table.insert(entries.map(x => { x.del = ""; return x }));

  entry_table.on("editable.save.cell", async (newValue, oldValue, row, column) => {
    if (newValue === oldValue) {
      return;
    }

    if (controller.running) {
      let cols = entry_table.data.data[row].cells.map(c => c.data);
      cols[column] = oldValue;
      entry_table.rows.updateRow(row, cols);
      return notyf.error("계측 중에는 엔트리를 변경할 수 없습니다.");
    }

    update_entry_table("변경사항이 저장되었습니다.", "변경사항을 저장하지 못했습니다.");
  });

  /* prevent editor doubleclick event for the delete entry buttons ************/
  document.getElementById("entry-table").addEventListener("dblclick", e => {
    if (e.target.classList.contains('delete-entry') || e.target.querySelector(".delete-entry")) {
      e.stopImmediatePropagation();
    }
  });

}

let record_table = undefined;
let log_table = undefined;

function setup_log_viewer() {
  record_table = new simpleDatatables.DataTable("#record-table", {
    columns: [
      { select: 0, sort: "asc" },
      { select: 1 },
      { select: 2 },
    ],
    data: {
      headings: [
        {
          text: "타임스탬프",
          data: "date",
        }, {
          text: "엔트리",
          data: "number"
        }, {
          text: "학교",
          data: "univ"
        }, {
          text: "팀",
          data: "team"
        }, {
          text: "레인",
          data: "lane"
        }, {
          text: "경기",
          data: "type"
        }, {
          text: "기록",
          data: "result",
        }, {
          text: "비고",
          data: "note",
        },
      ],
    },
    perPage: 100,
    perPageSelect: [10, 20, 50, 100],
  });

  log_table = new simpleDatatables.DataTable("#log-table", {
    columns: [
      { select: 0, sort: "asc", type: "date", format: "YYYY-MM-DD HH:mm:ss" },
      { select: 1 },
    ],
    data: {
      headings: [
        {
          text: "타임스탬프",
          data: "date"
        }, {
          text: "데이터",
          data: "data"
        }
      ],
    },
    perPage: 100,
    perPageSelect: [10, 20, 50, 100],
  });

  document.getElementById('file').addEventListener("change", async event => {
    record_table.data.data = [];
    record_table.update(true);

    log_table.data.data = [];
    log_table.update(true);

    document.getElementById('file-record-box').style.display = "block";
    document.getElementById('file-log-box').style.display = "none";

    if (event.target.value === "파일 선택") {
      return;
    }

    try {
      let data = await invoke('read_file', { name: event.target.value });

      if (event.target.value === "fsk-log.json") {
        data = JSON.parse(`[${data.toString().replace(/^}/gm, '},').slice(0, -2)}]`);
        document.getElementById('file-record-box').style.display = "none";
        document.getElementById('file-log-box').style.display = "block";
        log_table.data.data = [];
        log_table.insert(data.map(x => { return { date: date_to_string(new Date(x.date)), data: x.data } }));
      } else {
        data = JSON.parse(`[${data.toString().replace(/^}/gm, '},').slice(0, -2)}]`);
        document.getElementById('file-record-box').style.display = "block";
        document.getElementById('file-log-box').style.display = "none";
        record_table.data.data = [];
        record_table.insert(data.map(x => {
          let name, note;

          switch (x.type) {
            case "record":
              name = "기록 측정";
              note = `${x.result.delay} ms delay`;
              break;

            case "competitive":
              name = "동시 경주";
              note = '-';
              break;

            case "lap":
              name = "랩 타임 측정";
              note = `Rank ${x.result.rank} (+${x.result.diff} ms)`;
              break;


            default:
              name = "알 수 없음";
              note = '-';
              break;
          }

          return {
            date: date_to_string(new Date(x.time)),
            number: x.entry.number,
            univ: x.entry.univ,
            team: x.entry.team,
            lane: x.lane,
            type: name,
            result: `${x.result.ms} ms`,
            note: note,
          };
        }));
      }
    } catch (e) {
      notyf.error(`파일을 읽어오지 못했습니다.<br>${e}`);
    }
  });
}

async function update_log_viewer() {
  try {
    let files = await invoke('get_file_list');
    let html = "<option selected disabled>파일 선택</option>";

    for (let file of files) {
      html += `<option value='${file}'>${file}</option>`;
    }

    let select = document.getElementById('file');
    select.innerHTML = html;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (e) {
    return notyf.error(`파일 목록을 가져오지 못했습니다.<br>${e}`);
  }
}

/*******************************************************************************
 * utility functions                                                           *
 ******************************************************************************/
let entries = undefined;

async function refresh_entries() {
  try {
    entries = JSON.parse(await invoke('read_file', { name: "fsk-entry.json" }));
  } catch (e) {
    if (e.toString().includes("os error 2")) {
      notyf.error(`엔트리 파일을 찾을 수 없습니다.<br>${e.toString()}`);
    } else {
      notyf.error(`엔트리 파일이 손상되었습니다.<br>${e.toString()}`);
    }
    document.querySelectorAll(`nav, div.container`).forEach(el => el.classList.add("disabled"));
  }
}

function ms_to_clock(ms) {
  let hours = String(Math.floor(ms / (1000 * 60 * 60))).padStart(2, 0);
  let minutes = String(Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, 0);
  let seconds = String(Math.floor((ms % (1000 * 60)) / 1000)).padStart(2, 0);

  return `${hours}:${minutes}:${seconds}.${String(ms % 1000).padStart(3, 0)}`;
}

function date_to_string(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, 0)}-${String(date.getDate()).padStart(2, 0)} ${String(date.getHours()).padStart(2, 0)}:${String(date.getMinutes()).padStart(2, 0)}:${String(date.getSeconds()).padStart(2, 0)}`;
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
      <td id="sensor-offset-lane-${num}" class="sensor-offset" style="padding-left: 1rem;"></td>
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
        <button class="deselect-team"><i class="fa fa-x"></i></button>
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
      </td>
    </tr>`;
}

function delete_entry(row) {
  entry_table.rows.remove(row);
  update_entry_table("엔트리가 삭제되었습니다.", "엔트리를 삭제하지 못했습니다.");
}

async function update_entry_table(success_msg, error_msg) {
  let edited = entry_table.data.data.map(x => x.cells.map(y => y.text));
  edited = edited.map(entry => { return { number: entry[0], univ: entry[1], team: entry[2] } });
  edited = edited.sort((a, b) => Number(a.number) - Number(b.number));

  try {
    await invoke('write_entry', { data: JSON.stringify(edited, null, 2) });
    await refresh_entries();

    document.querySelectorAll('select.select-team').forEach(el => {
      el.innerHTML = template_team_select(el.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    notyf.success(success_msg);
  } catch (e) {
    notyf.error(`${error_msg}<br>${e}`);
  }

}
