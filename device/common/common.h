#ifndef COMMON_H
#define COMMON_H

#include <stdint.h>
#include <stdio.h>

#include "crc.h"
#include "main.h"
#include "usart.h"

#define true  (1)
#define false (0)

/*******************************************************************************
 * printf
 ******************************************************************************/
#ifdef DEVICE_TYPE_CONTROLLER
#include "usbd_cdc_if.h"

#define MAX_LEN_USB_CMD (10)
#define USB_Transmit(buf, len)             \
  {                                        \
    uint8_t usb_ret;                       \
    do {                                   \
      usb_ret = CDC_Transmit_FS(buf, len); \
    } while (usb_ret == USBD_BUSY);        \
  }
#define USB_Command(CMD) \
  (strncmp((const char *)UserRxBufferFS, usb_cmd[CMD], strlen(usb_cmd[CMD])) == 0)
#endif

#ifdef DEBUG
#ifdef DEVICE_TYPE_CONTROLLER
static inline void usb_printf(const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  vsprintf(usb_buf, fmt, args);
  USB_Transmit((uint8_t *)usb_buf, strlen(usb_buf));
}
#define DEBUG_MSG(fmt, ...) usb_print(fmt, ##__VA_ARGS__)
#else /* DEVICE_TYPE_CONTROLLER */
#define DEBUG_MSG(...) printf(__VA_ARGS__)
#endif /* DEVICE_TYPE_CONTROLLER */
#else /* DEBUG */
#define DEBUG_MSG(...)
#endif /* DEBUG */


/*******************************************************************************
 * traffic light control
 ******************************************************************************/
#ifdef DEVICE_TYPE_CONTROLLER
#define RED(POWER) \
  HAL_GPIO_WritePin(RED_GPIO_Port, RED_Pin, POWER ? GPIO_PIN_SET : GPIO_PIN_RESET);
#define GREEN(POWER) \
  HAL_GPIO_WritePin(GREEN_GPIO_Port, GREEN_Pin, POWER ? GPIO_PIN_SET : GPIO_PIN_RESET);
#endif

/*******************************************************************************
 * device operation mode
 ******************************************************************************/
typedef enum {
  MODE_STARTUP,
  MODE_USB_READY,
  MODE_LSNTP,
  MODE_OPERATION,
} operation_mode_t;

/*******************************************************************************
 * get device id from the flash
 ******************************************************************************/

// RM0368 Table 5. Flash module organization (STM32F401xB/C and STM32F401xD/E)
#define FLASH_SECTOR_DEVICE_ID       (0x08020000) // Sector 5 (128 KB). ~ 0x0803FFFF
#define FLASH_ADDR_DEVICE_ID_CANARY  (FLASH_SECTOR_DEVICE_ID + 0x0001FF00)
#define FLASH_ADDR_DEVICE_ID         (FLASH_ADDR_DEVICE_ID_CANARY + 4)
#define FLASH_DEVICE_ID_CANARY_VALUE (0xBADACAFE)

/***************************************
 * device id ranges
 * 0         : broadcast
 * 1 ~ 200   : sensors
 * 201 ~ 254 : controllers
 * 255       : invalid
 **************************************/
#define DEVICE_ID_INVALID (0xFF)

static inline uint8_t get_device_id(void) {
  // device id canary mismatch
  if (*(uint32_t *)FLASH_ADDR_DEVICE_ID_CANARY != FLASH_DEVICE_ID_CANARY_VALUE) {
    DEBUG_MSG("flash memory device id canary mismatch\n");
    Error_Handler();
  }

  uint8_t id = *(uint8_t *)FLASH_ADDR_DEVICE_ID;

  if (id == DEVICE_ID_INVALID) {
    DEBUG_MSG("flash memory device id invalid\n");
    Error_Handler();
  }

  return id;
}


/*******************************************************************************
 * LoRa typedefs and definitions
 ******************************************************************************/
#define LORA_ID_BROADCAST (0)
#define LORA_HEADER_MAGIC (0x55)
#define LORA_TIMEOUT      (500)

typedef enum {
  LORA_STATUS_OK = 0,
  LORA_STATUS_ERR_MAGIC,
  LORA_STATUS_ERR_CHECKSUM,
  LORA_STATUS_ERR_NOT_ME,
} lora_status_t;

typedef enum {
  LORA_LSNTP_REQ,     // LSNTP time request from client
  LORA_LSNTP_RES,     // LSNTP time reply from server
  LORA_READY,         // sensor LSNTP complete and ready to go
  LORA_SENSOR_REPORT, // sensor detection detection
  LORA_ACK,           // ack
} lora_protocol_t;

/*******************************************************************************
 * LoRa packet header
 ******************************************************************************/

typedef struct {
  uint8_t magic;        // packet magic byte
  uint8_t protocol : 4; // lora mesage type
  uint8_t sequence : 4; // packet sequence
  uint8_t sender;       // sender device id
  uint8_t receiver;     // receiver device id
  uint32_t checksum;    // CRC checksum
} lora_header_t;

/*******************************************************************************
 * LoRa utility functions
 ******************************************************************************/

/**
 * @brief calculate and set CRC checksum of the lora packet
 *
 * @param [in] header lora packet header pointer
 * @param [in] size   lora packet size
 */
static inline void lora_set_checksum(lora_header_t *header, uint32_t size) {
  header->magic = LORA_HEADER_MAGIC;
  header->checksum = 0;
  header->checksum = HAL_CRC_Calculate(&hcrc, (uint32_t *)header, size / sizeof(uint32_t));
}

/**
 * @brief verify CRC checksum and receiver of the lora packet
 *
 * @param[in] id     my device id
 * @param[in] header lora packet header pointer
 * @param[in] size   lora packet size
 */
static inline int32_t lora_verify(uint8_t id, lora_header_t *header, uint32_t size) {
  if (header->magic != LORA_HEADER_MAGIC) {
    return LORA_STATUS_ERR_MAGIC;
  }

  uint16_t checksum = header->checksum;
  header->checksum = 0;

  if (checksum != HAL_CRC_Calculate(&hcrc, (uint32_t *)header, size / sizeof(uint32_t))) {
    return LORA_STATUS_ERR_CHECKSUM;
  }

  if (header->receiver != id || header->receiver != LORA_ID_BROADCAST) {
    return LORA_STATUS_ERR_NOT_ME;
  }

  return LORA_STATUS_OK;
}


/*******************************************************************************
 * LSNTP (LoRa Simple Network Time Protocol) implementation
 * from RFC 4330 (https://datatracker.ietf.org/doc/html/rfc4330) Page 13
 ******************************************************************************/
#define LSNTP_ITER_COUNT (5)

typedef struct {
  lora_header_t header;
  uint32_t client_req_tx; // time request sent by client
} lora_lsntp_req_t;

typedef struct {
  lora_header_t header;
  uint32_t client_req_tx; // time request sent by client
  uint32_t server_req_rx; // time request received by server
  uint32_t server_res_tx; // time reply sent by server
} lora_lsntp_res_t;

static inline int32_t lsntp_calc_offset(lora_lsntp_res_t *pkt, uint32_t client_res_rx) {
  // round trip time calculation
  #ifdef DEBUG
  int32_t rtt = ((int32_t)client_res_rx - (int32_t)(pkt->client_req_tx)) - ((int32_t)(pkt->server_res_tx) - (int32_t)(pkt->server_req_rx));
  DEBUG_MSG("RTT: %ld\n", rtt);
  #endif

  // system clock offset calculation
  int32_t offset = (((int32_t)(pkt->server_req_rx) - (int32_t)(pkt->client_req_tx)) + ((int32_t)(pkt->server_res_tx) - (int32_t)client_res_rx)) / 2;

  return offset;
}

/*******************************************************************************
 * LoRa sensor detection REPORT
 ******************************************************************************/
typedef struct {
  lora_header_t header;
  uint32_t timestamp;
} lora_sensor_report_t;

/*******************************************************************************
 * LoRa READY - LSNTP finish
 ******************************************************************************/
typedef struct {
  lora_header_t header;
  int32_t offset;
} lora_ready_t;

/*******************************************************************************
 * LoRa ACK
 ******************************************************************************/
typedef struct {
  lora_header_t header;
} lora_ack_t;

#endif /* COMMON_H */
