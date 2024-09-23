# Formula Student Korea Traffic Controller

## Usage (TL;DR)

1. Download the `fsk-traffic-control` application and the `fsk-entry.json` at the [Releases](https://github.com/luftaquila/fsk-traffic-control/releases).
2. Put the application and the `fsk-entry.json` in the same directory.
3. Run `fsk-traffic-control` and update your entry in the application.
4. Connect controller to the PC and click the `Connect Controller` button.
5. Set sensor IDs to use and click the `Configure sensors` button.
6. Power up sensors to perform a time sync between the controller and sensors.
7. Set the event name and the participating teams.
8. All ready! Turn on the green light.

## Do It Yourself!
DIY section describes how to make the hardwares and upload firmware to it, and how to build the desktop application.

### Build your devices

#### Bill of Materials (BOM)

TODO

* [Controller](https://github.com/luftaquila/fsk-traffic-control/tree/main/device/controller/schematics/bom)
* [Sensor](https://github.com/luftaquila/fsk-traffic-control/tree/main/device/sensor/schematics/bom)

#### Schematics (KiCAD)

TODO

* [Controller](https://github.com/luftaquila/fsk-traffic-control/tree/main/device/controller/schematics)
* [Sensor](https://github.com/luftaquila/fsk-traffic-control/tree/main/device/sensor/schematics)

#### 3D printed housing design file (Fusion 360)

* [Controller](https://github.com/luftaquila/fsk-traffic-control/tree/main/device/controller/3d)
* [Sensor](https://github.com/luftaquila/fsk-traffic-control/tree/main/device/sensor/3d)

### Upload firmware to the devices

> [!TIP]
> If you want to use the original firmware as-is, download the prebuilt firmware at the [Releases](https://github.com/luftaquila/fsk-traffic-control/releases) and use [STM32CubeProgrammer](https://www.st.com/en/development-tools/stm32cubeprog.html) to upload firmware elf to the devices.

#### Prerequisites

1. Arm GNU Toolchain
    * Download **AArch32 bare-metal target (arm-none-eabi)** at [Arm GNU Toolchain Downloads](https://developer.arm.com/downloads/-/arm-gnu-toolchain-downloads)

* Windows
    * Make sure that `arm-none-eabi-gcc.exe`, `make.exe`, `openocd.exe` is at your `$PATH`
    * [OpenOCD for Windows](https://gnutoolchains.com/arm-eabi/openocd/)
    * [Make for Windows](https://gnuwin32.sourceforge.net/packages/make.htm)
* MacOS
    * Make sure that `arm-none-eabi-gcc` is at your `$PATH`
    ```sh
    brew install make openocd
    ```
* Linux
    * Make sure that `arm-none-eabi-gcc` is at your `$PATH`
    ```sh
    sudo apt-get install build-essential openocd
    ```

2. Clone repository
    ```sh
    git clone https://github.com/luftaquila/fsk-traffic-control.git --recursive
    ```

#### Build and upload

* Controller
    ```sh
    cd device/controller/firmware
    make program
    ```

* Sensor
    ```sh
    cd device/sensor/firmware
    make program
    ```

> [!NOTE]
> If you want to get the debug outputs, upload debug mode firmware by `make debug` command and connect the USB to UART converter to the device's USART1 port (PB6, PB7).

### Desktop Application

> [!TIP]
> If you want to use the original application as-is, download the prebuilt binary and follow the instructions at the [Releases](https://github.com/luftaquila/fsk-traffic-control/releases).

* Note: not yet tested at Linux!

#### Prerequisites

1. [Node.js](https://nodejs.org/en/download/package-manager) >= v20
2. [Rust](https://www.rust-lang.org/tools/install) >= 1.81.0
3. Clone the repository and install dependencies
    ```sh
    git clone https://github.com/luftaquila/fsk-traffic-control.git --recursive
    cd fsk-traffic-control/native
    npm install
    ```

#### Run

```sh
npm run tauri dev
```

#### Build

```sh
npm run tauri build
```
