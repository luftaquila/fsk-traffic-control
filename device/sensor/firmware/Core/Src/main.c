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
#include "gpio.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdint.h>

#include "LoRa.h"
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
LoRa rf;

uint32_t exti_sensor = false;
uint32_t exti_rf = false;

uint8_t id = DEVICE_ID_INVALID;
uint8_t controller_id = DEVICE_ID_INVALID;

uint32_t mode = MODE_STARTUP;

int32_t lsntp_offset = 0;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
  // sensor detection
  if (GPIO_Pin == SENSOR_Pin) {
    exti_sensor = true;
  }

  // RF data received
  else if (GPIO_Pin == DIO0_Pin) {
    exti_rf = true;
  }
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
  MX_USART1_UART_Init();
  MX_CRC_Init();
  /* USER CODE BEGIN 2 */
  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);

  // get device id
  id = get_device_id();
  DEBUG_MSG("id: %d\n", id);

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
    Error_Handler();
  }

  // start LSNTP time sync
  LoRa_startReceiving(&rf);
  mode = MODE_LSNTP;

  /*****************************************************************************
   * do LSNTP
   ****************************************************************************/
  lora_lsntp_t packet;
  packet.header.size = sizeof(lora_lsntp_t);
  packet.header.protocol = LORA_LSNTP_REQ;
  packet.header.sender = id;
  packet.header.receiver = 0;

  int32_t seq = 0;
  int32_t success = 0;
  int32_t transmit_new_req = true;
  int32_t offset[LSNTP_ITER_COUNT];

  DEBUG_MSG("start LSNTP\n");

  while (true) {
    // too many failures
    if (seq > 15) {
      Error_Handler();
    }

    if (transmit_new_req) {
      packet.header.sequence = seq;
      packet.client_req_tx = HAL_GetTick();
      lora_set_checksum(&packet.header, sizeof(packet));
      LoRa_transmit(&rf, (uint8_t *)&packet, sizeof(packet), 500);

      DEBUG_MSG("LSNTP req #%ld\n", seq);

      seq++;
      transmit_new_req = false;
    }

    // busy wait for the reply
    while (!exti_rf) {
      // 500ms timeout
      if (HAL_GetTick() > packet.client_req_tx + 500) {
        transmit_new_req = true;
        break;
      }
    }

    // timeout; make new request
    if (transmit_new_req) {
      DEBUG_MSG("  timeout!\n");
      continue;
    }

    // parse received packet
    uint8_t buf[128];
    lora_lsntp_t *pkt = (lora_lsntp_t *)buf;
    uint8_t recv_bytes = LoRa_receive(&rf, buf, sizeof(packet));

    // no full packet received
    if (recv_bytes != sizeof(packet)) {
      continue;
    }

    // checksum failure
    if (lora_verify(id, &pkt->header, sizeof(packet)) == LORA_STATUS_OK) {
      continue;
    }

    // wrong packet
    if (pkt->header.protocol != LORA_LSNTP_RES || pkt->header.sequence != seq) {
      continue;
    }

    // calculate offset
    pkt->client_res_rx = HAL_GetTick();
    offset[success] = lsntp_calc_offset(pkt);
    lsntp_offset += offset[success];
    DEBUG_MSG("  offset: %ld\n", offset[success]);

    // set controller id
    controller_id = pkt->header.sender;

    success++;
    transmit_new_req = true;

    if (success >= LSNTP_ITER_COUNT) {
      break;
    }
  }

  lsntp_offset /= LSNTP_ITER_COUNT;
  DEBUG_MSG("done LSNTP. offset: %ld\n", lsntp_offset);
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  mode = MODE_OPERATION;
  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);

  while (1) {
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
  RCC_OscInitStruct.PLL.PLLN = 168;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV2;
  RCC_OscInitStruct.PLL.PLLQ = 4;
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
  DEBUG_MSG("ERROR!\n");

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
