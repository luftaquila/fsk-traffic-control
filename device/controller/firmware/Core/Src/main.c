/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2024 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "crc.h"
#include "spi.h"
#include "usart.h"
#include "usb_device.h"
#include "gpio.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdint.h>

#include "LoRa.h"

#define DEVICE_TYPE_CONTROLLER
#include "common.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/

/* USER CODE BEGIN PV */
uint8_t id = DEVICE_ID_INVALID;
uint32_t mode = MODE_STARTUP;

/* LoRa object, receive buffer and flag */
LoRa rf;

uint32_t exti_rf = false;
uint32_t exti_rf_timestamp = 0;

uint8_t rf_buf[UINT8_MAX];
uint8_t rf_buf_read = 0;

/* sensors to use */
uint32_t cnt_sensor = 0;
uint32_t cnt_sensor_ready = 0;
uint8_t sensors[UINT8_MAX];
uint8_t sensors_ready[UINT8_MAX];

/* USB buffer and flag */
uint32_t usb_rcv_flag = false;
extern uint8_t UserRxBufferFS[];
extern uint8_t UserTxBufferFS[];

/* USB CDC command from the host system */
typedef enum {
  CMD_HELLO,
  CMD_SENSOR,
  CMD_GREEN,
  CMD_RED,
  CMD_OFF,
  CMD_RESET,
  CMD_COUNT,
} usb_cmd_type_t;

const char usb_cmd[CMD_COUNT][MAX_LEN_USB_CMD + 1] = {
  "$HELLO",
  "$SENSOR",
  "$GREEN",
  "$RED",
  "$OFF",
  "$RESET",
};

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
  // RF data received
  if (GPIO_Pin == DIO0_Pin) {
    exti_rf = true;
    exti_rf_timestamp = HAL_GetTick();
    rf_buf_read = LoRa_receive(&rf, rf_buf, sizeof(rf_buf));
    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);
    DEBUG_MSG("\nrcv %dB\n", rf_buf_read);
  }
}

int _write(int file, uint8_t *ptr, int len) {
  HAL_UART_Transmit(&huart1, (uint8_t *)ptr, (uint16_t)len, 30);
  return (len);
}
/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_SPI2_Init();
  MX_CRC_Init();
  MX_USART1_UART_Init();
  MX_USB_DEVICE_Init();
  /* USER CODE BEGIN 2 */
  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);

  // get device id
  id = get_device_id();
  DEBUG_MSG("\nid: %u\n", id);

  // init Ra-01H LoRa transceiver
  rf = newLoRa();
  rf.CS_port = NSS_GPIO_Port;
  rf.CS_pin = NSS_Pin;
  rf.reset_port = RST_GPIO_Port;
  rf.reset_pin = RST_Pin;
  rf.DIO0_port = DIO0_GPIO_Port;
  rf.DIO0_pin = DIO0_Pin;
  rf.hSPIx = &hspi2;

  rf.frequency = 923;             // CH 30 922.9 Mhz
  rf.spredingFactor = SF_7;
  rf.bandWidth = BW_125KHz;
  rf.crcRate = CR_4_5;
  rf.power = POWER_14db;          // 25 mW
  rf.overCurrentProtection = 100; // 100 mA
  rf.preamble = 8;

  if (LoRa_init(&rf) != LORA_OK) {
    DEBUG_MSG("\nLoRa init failed\n");
    Error_Handler();
  }

  /*****************************************************************************
   * FSK-TC CONTROLLER workflow                                                *
   *   1. wait for start command from the USB host                             *
   *   2. register sensor devices                                              *
   *   3. run LSNTP time sync server until all sensors are READY               *
   *   4. listen sensor REPORT                                                 *
   *   5. control traffic light                                                *
   ****************************************************************************/

  // flash traffic light 3 times
  for (int i = 0; i < 6; i++) {
    // on at even, off at odd
    RED(!(i & 0b01));
    GREEN(!(i & 0b01));
    HAL_Delay(200);
  }

  mode = MODE_USB_READY;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1) {
    switch (mode) {
      case MODE_USB_READY: {
        // ignore lora
        if (exti_rf) {
          exti_rf = false;
          HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);
        }

        if (usb_rcv_flag) {
          /*************************************************************************
           * protocol $SENSOR: set sensors to use. $READY-ALL on all sensor LSNTP done
           *   request : $SENSOR <%03d sensor count> <...%03d sensor ids>
           *   response: $LSNTP on start, $READY-ALL on finish
           ************************************************************************/
          if (USB_Command(CMD_SENSOR)) {
            uint8_t *cmd = UserRxBufferFS + strlen(usb_cmd[CMD_SENSOR]) + 1;

            // read sensor count
            *(cmd + 3) = '\0';
            cnt_sensor = atoi((const char *)cmd);
            cnt_sensor_ready = 0;
            cmd += 4;

            // read sensor ids
            for (int i = 0; i < cnt_sensor; i++) {
              *(cmd + 3) = '\0';
              sensors[i] = atoi((const char *)cmd);
              sensors_ready[i] = false;
              cmd += 4;
            }

            // start LSNTP server
            mode = MODE_LSNTP;
            LoRa_startReceiving(&rf);
            USB_Transmit("$LSNTP!");
          }

          /*************************************************************************
           * protocol $HELLO: greetings!
           *   request : $HELLO
           *   response: $HI <%03d my id>
           ************************************************************************/
          else if (USB_Command(CMD_HELLO)) {
            sprintf((char *)UserTxBufferFS, "$HI %03u!", id);
            USB_Transmit(UserTxBufferFS);
          }

          /*************************************************************************
           * protocol $RESET: see you again!
           *   request : $RESET
           *   response: -
           ************************************************************************/
          else if (USB_Command(CMD_RESET)) {
            NVIC_SystemReset();
          }

          // unknown command
          else {
            USB_Transmit("$ERROR!");
          }

          usb_rcv_flag = false;
        }

        break;
      } /* MODE_USB_READY */

      case MODE_LSNTP: {
        if (exti_rf) {
          uint8_t *pos = rf_buf;

          while (pos < rf_buf + rf_buf_read) {
            if (*pos != LORA_HEADER_MAGIC) {
              pos++;
              continue;
            }

            // read packet header
            uint32_t size = 0;
            lora_header_t *req = (lora_header_t *)pos;

            switch (req->protocol) {
              case LORA_LSNTP_REQ: {
                size = sizeof(lora_lsntp_req_t);
                break;
              }

              case LORA_READY: {
                size = sizeof(lora_ready_t);
                break;
              }

              // unknown protocol
              default: {
                pos++;
                continue;
              }
            } /* switch (req->protocol) */

            // no full packet received
            if (pos + size > rf_buf + rf_buf_read) {
              break;
            }

            // checksum failure
            int32_t ret = lora_verify(id, req, size);

            if (ret != LORA_STATUS_OK) {
              DEBUG_MSG("  packet verify failure; result: %ld\n", ret);
              pos++;
              continue;
            }

            // check sender in the registered sensors list
            int32_t registered = false;

            for (int i = 0; i < cnt_sensor; i++) {
              if (req->sender == sensors[i]) {
                registered = true;
                break;
              }
            }

            // ignore unregistered sensors
            if (!registered) {
              pos += size;
              continue;
            }

            // send reply
            switch (req->protocol) {
              case LORA_LSNTP_REQ: {
                lora_lsntp_res_t reply;
                reply.header.protocol = LORA_LSNTP_RES;
                reply.header.sequence = req->sequence;
                reply.header.sender = id;
                reply.header.receiver = req->sender;
                reply.client_req_tx = ((lora_lsntp_req_t *)req)->client_req_tx;
                reply.server_req_rx = exti_rf_timestamp;
                reply.server_res_tx = HAL_GetTick();
                lora_set_checksum(&reply.header, sizeof(lora_lsntp_res_t));
                HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);
                LoRa_transmit(&rf, (uint8_t *)&reply, sizeof(lora_lsntp_res_t), 500);
                HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);
                break;
              }

              case LORA_READY: {
                lora_ack_t ack;
                ack.header.protocol = LORA_ACK;
                ack.header.sequence = req->sequence;
                ack.header.sender = id;
                ack.header.receiver = req->sender;

                // accept but not increase ready count if the sensor is already registered
                if (sensors_ready[req->sender] == false) {
                  sensors_ready[req->sender] = true;
                  cnt_sensor_ready++;
                }

                lora_set_checksum(&ack.header, sizeof(lora_ack_t));
                HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);
                LoRa_transmit(&rf, (uint8_t *)&ack, sizeof(lora_ack_t), 500);
                HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);

                /*************************************************************
                 * protocol $READY: notify sensor ready
                 *   notify: $READY <%03d sensor id> <%d sensor offset>
                 ************************************************************/
                sprintf((char *)UserTxBufferFS, "$READY %03u %ld!", req->sender, ((lora_ready_t *)req)->offset);
                USB_Transmit(UserTxBufferFS);

                break;
              }
            } /* switch (header->protocol)*/

            pos += size;
          } /* while buffer */

          exti_rf = false;
          HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);
        } /* exti_rf */

        // all registered sensors are ready
        if (cnt_sensor_ready == cnt_sensor) {
          mode = MODE_OPERATION;
          USB_Transmit("$READY-ALL!");
        }

        if (usb_rcv_flag) {
          /*************************************************************************
           * protocol $RESET: see you again!
           *   request : $RESET
           *   response: -
           ************************************************************************/
          if (USB_Command(CMD_RESET)) {
            NVIC_SystemReset();
          }

          // unknown command
          else {
            USB_Transmit("$ERROR!");
          }

          usb_rcv_flag = false;
        }
        break;
      } /* MODE_LSNTP */

      case MODE_OPERATION: {
        if (exti_rf) {
          uint8_t *pos = rf_buf;

          while (pos < rf_buf + rf_buf_read) {
            if (*pos != LORA_HEADER_MAGIC) {
              pos++;
              continue;
            }

            // read packet header
            uint32_t size = sizeof(lora_sensor_report_t);
            lora_header_t *req = (lora_header_t *)pos;

            // unknown protocol
            if (req->protocol != LORA_SENSOR_REPORT) {
              pos++;
              continue;
            }

            // no full packet received
            if (pos + size > rf_buf + rf_buf_read) {
              break;
            }

            // checksum failure
            int32_t ret = lora_verify(id, req, size);

            if (ret != LORA_STATUS_OK) {
              DEBUG_MSG("  packet verify failure; result: %ld\n", ret);
              pos++;
              continue;
            }

            lora_ack_t ack;
            ack.header.protocol = LORA_ACK;
            ack.header.sequence = req->sequence;
            ack.header.sender = id;
            ack.header.receiver = req->sender;
            lora_set_checksum(&ack.header, sizeof(lora_ack_t));
            HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);
            LoRa_transmit(&rf, (uint8_t *)&ack, sizeof(lora_ack_t), 500);
            HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);

            /*************************************************************
             * protocol $REPORT: notify sensor report
             *   notify: $REPORT <%03d sensor id> <%d timestamp>
             ************************************************************/
            sprintf((char *)UserTxBufferFS, "$REPORT %03u %lu!", req->sender, ((lora_sensor_report_t *)req)->timestamp);
            USB_Transmit(UserTxBufferFS)

            pos += size;
          } /* while buffer */

          exti_rf = false;
          HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);
        } /* exti_rf */

        if (usb_rcv_flag) {
          /*************************************************************************
           * protocol $GREEN: GREEN ON, RED OFF. mark timestamp
           *   request : $GREEN
           *   response: $START <start timestamp>
           ************************************************************************/
          if (USB_Command(CMD_GREEN)) {
            RED(false);
            GREEN(true);

            uint32_t start_time = HAL_GetTick();

            sprintf((char *)UserTxBufferFS, "$START %lu!", start_time);
            USB_Transmit(UserTxBufferFS);
          }

          /*************************************************************************
           * protocol $RED: RED ON, GREEN OFF.
           *   request : $RED
           *   response: $OK-RED
           ************************************************************************/
          else if (USB_Command(CMD_RED)) {
            RED(true);
            GREEN(false);

            USB_Transmit("$OK-RED!");
          }

          /*************************************************************************
           * protocol $OFF: RED OFF, GREEN OFF
           *   request : $OFF
           *   response: $OK-OFF
           ************************************************************************/
          else if (USB_Command(CMD_OFF)) {
            RED(false);
            GREEN(false);

            USB_Transmit("$OK-OFF!");
          }

          /*************************************************************************
           * protocol $RESET: see you again!
           *   request : $RESET
           *   response: -
           ************************************************************************/
          else if (USB_Command(CMD_RESET)) {
            NVIC_SystemReset();
          }

          // unknown command
          else {
            USB_Transmit("$ERROR!");
          }

          usb_rcv_flag = false;
        }

        break;
      } /* MODE_OPERATION */
      
      default:
        if (exti_rf) {
          exti_rf = false;
          HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);
        }
        break;
    }
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE2);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLM = 25;
  RCC_OscInitStruct.PLL.PLLN = 336;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV4;
  RCC_OscInitStruct.PLL.PLLQ = 7;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  DEBUG_MSG("\nERROR!\n");

  while (1) {
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
    HAL_Delay(100);
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
