const { SerialPort } = require('serialport');

let port;

process.on('message', data => {
  switch (data.key) {
    // open target serial port
    case 'serial-target': {
      port = new SerialPort({ path: data.data, baudRate: 115200 });

      port.on('open', () => {
        console.log('port open!');
      });

      port.on('error', err => {
        console.error(`port failed: ${err.message}`);
      });

      // pass received data to the renderer
      port.on('data', data => {
        process.send({ key: 'serial-data', data: data });
      });

      break;
    }

    // send requested data
    case 'serial-request': {
      if (!port) {
        return console.error('target port unavailable!');
      }

      port.write(data.data, err => {
        if (err) {
          return console.error(`serial write failed: ${err.message}`);
        }
      });

      break;
    }
  }
});
