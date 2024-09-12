# Formula Student Korea Traffic Controller

## Usage

## Do It Yourself!
DIY section describes how to make the hardwares and upload firmware to it, and how to build the desktop application.

### Build devices

#### BOM

* Controller
    * TODO
* Sensor
    * TODO

#### Schematics

* Controller
    * TODO
* Sensor
    * TODO

### Upload firmware to the devices

#### Use prebuilt firmware
If you want to use the original firmware as-is, download the prebuilt firmware at the [Releases](https://github.com/luftaquila/fsk-traffic-control/releases) and use [STM32CubeProgrammer](https://www.st.com/en/development-tools/stm32cubeprog.html) to upload firmware elf to the devices.

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

If you want to get the debug outputs, upload debug mode firmware by `make debug` command and connect the USB to UART converter to the devices' USART1 port (PB6, PB7).

### Desktop Application

#### Prerequisites

1. Node.js >= v20
    * [Download Node.js](https://nodejs.org/en/download/package-manager)

2. Clone repository and install dependencies
```sh
git clone https://github.com/luftaquila/fsk-traffic-control.git --recursive
cd fsk-traffic-control/native
npm install
```

#### Run

```sh
npm start
```

#### Build

```sh
npm run build
```
