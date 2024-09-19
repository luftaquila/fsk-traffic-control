#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::prelude::*;
use serialport::{SerialPort, SerialPortType};
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, State, Window};

/*******************************************************************************
* Serial port manipulators                                                     *
*******************************************************************************/
#[derive(Default)]
struct Controller {
    port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
}

#[tauri::command]
fn serial_connect(state: State<Controller>) -> Result<String, String> {
    let mut shared_port = state.port.lock().unwrap();

    if let Some(port) = shared_port.take() {
        drop(port);
    }

    let ports = serialport::available_ports().map_err(|e| e.to_string())?;

    let target_vid = 0x1999;
    let target_pid = 0x0514;

    let port_info = ports
        .into_iter()
        .find(|p| {
            if let SerialPortType::UsbPort(ref usb_port) = p.port_type {
                usb_port.vid == target_vid && usb_port.pid == target_pid
            } else {
                false
            }
        })
        .ok_or_else(|| "No matching device found".to_string())?;

    let port = serialport::new(&port_info.port_name, 115200)
        .open()
        .map_err(|e| e.to_string())?;

    *shared_port = Some(port);

    Ok(port_info.port_name)
}

#[tauri::command]
fn serial_request(
    state: State<Controller>,
    window: Window,
    data: String,
) -> Result<String, String> {
    println!("{} sender: try lock", Local::now());
    let mut shared_port = state.port.lock().unwrap();
    println!("{} sender: got lock", Local::now());

    if let Some(ref mut port) = *shared_port {
        match port.write(data.as_bytes()) {
            Ok(_) => Ok("Data sent successfully".to_string()),
            Err(e) => {
                *shared_port = None;
                window
                    .emit(
                        "serial-error",
                        format!("데이터 송신 오류: {}", e.to_string()),
                    )
                    .unwrap();
                Err(format!("Failed to send data: {}", e))
            }
        }
    } else {
        window
            .emit("serial-error", "연결된 시리얼 포트가 없습니다.".to_string())
            .unwrap();
        Err("No connected serial port".to_string())
    }
}

fn serial_listen(app_handle: tauri::AppHandle, port: Arc<Mutex<Option<Box<dyn SerialPort>>>>) {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        loop {
            {
                println!("{} receiver: before lock", Local::now());
                let mut shared_port = port.lock().unwrap();
                println!("{} receiver: after lock", Local::now());

                if let Some(ref mut port) = *shared_port {
                    let mut buf: [u8; 1024] = [0; 1024];
                    match port.read(&mut buf) {
                        Ok(bytes_read) => {
                            if bytes_read > 0 {
                                buffer.extend_from_slice(&buf[..bytes_read]);

                                while let Some(pos) = buffer.iter().position(|&x| x == b'!') {
                                    let data = String::from_utf8_lossy(&buffer[..=pos]).to_string();
                                    app_handle.emit_all("serial-data", data).unwrap();
                                    buffer = buffer.split_off(pos + 1);
                                }
                            }
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                        Err(e) => {
                            *shared_port = None;
                            app_handle
                                .emit_all(
                                    "serial-error",
                                    format!("데이터 수신 오류: {}", e.to_string()),
                                )
                                .unwrap();
                        }
                    }
                }
            }

            println!("{} receiver: before sleep", Local::now());
            thread::sleep(Duration::from_millis(100));
            println!("{} receiver: after sleep", Local::now());
        }
    });
}

/*******************************************************************************
* File manipulators                                                            *
*******************************************************************************/
#[tauri::command]
async fn get_file_list() -> Result<Vec<String>, String> {
    let base_path = std::env::current_dir().unwrap();
    match fs::read_dir(base_path) {
        Ok(entries) => {
            let result: Vec<String> = entries
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| entry.file_name().into_string().ok())
                .filter(|name| name.to_lowercase().starts_with("fsk") && name != "fsk-entry.json")
                .collect();
            Ok(result)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

#[tauri::command]
async fn read_file(name: String) -> Result<String, String> {
    let base_path = std::env::current_dir().unwrap();
    let file_path = base_path.join(name.clone());
    match fs::read_to_string(&file_path) {
        Ok(filedata) => Ok(filedata),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}

#[tauri::command]
async fn append_file(name: String, data: String) -> Result<String, String> {
    let base_path = std::env::current_dir().unwrap();
    let file_name = if name == "fsk-log.json" {
        "fsk-log.json".to_string()
    } else {
        format!(
            "FSK-{}-{}.json",
            Local::now().format("%Y-%m-%d").to_string(),
            name
        )
    };
    let file_path = base_path.join(file_name.clone());

    match OpenOptions::new()
        .append(true)
        .create(true)
        .open(&file_path)
    {
        Ok(mut file) => {
            if let Err(e) = std::io::Write::write_all(&mut file, data.as_bytes()) {
                return Err(format!("Failed to append to file: {}", e));
            }
            Ok(file_name.to_string())
        }
        Err(e) => Err(format!("Failed to open file: {}", e)),
    }
}

#[tauri::command]
async fn write_entry(data: String) -> Result<(), String> {
    let base_path = std::env::current_dir().unwrap();
    let file_path = base_path.join("fsk-entry.json");

    match fs::write(file_path, data) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to write entry: {}", e)),
    }
}

#[tauri::command]
fn open_url() {
    open::that("https://github.com/luftaquila/fsk-traffic-control").unwrap();
}

/*******************************************************************************
* Main application                                                             *
*******************************************************************************/
fn main() {
    tauri::Builder::default()
        .manage(Controller::default())
        .setup(|app| {
            let app_handle = app.handle();
            let controller = app.state::<Controller>().port.clone();
            serial_listen(app_handle, controller);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            serial_connect,
            serial_request,
            get_file_list,
            read_file,
            append_file,
            write_entry,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
