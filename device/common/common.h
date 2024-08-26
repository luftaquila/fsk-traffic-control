#ifndef COMMON_H
#define COMMON_H

#include <stdint.h>
#include <stdio.h>

#include "main.h"
#include "crc.h"
#include "usart.h"

#define true  (1)
#define false (0)

/*******************************************************************************
 * device operation mode
 ******************************************************************************/
typedef enum {
  MODE_STARTUP,
  MODE_LSNTP,
  MODE_OPERATION,
} operation_mode_t;

/*******************************************************************************
 * get device id from the flash
 ******************************************************************************/

// RM0368 Table 5. Flash module organization (STM32F401xB/C and STM32F401xD/E)
#define FLASH_SECTOR_DEVICE_ID (0x08020000) // Sector 5 (128 KB). ~ 0x0803FFFF
#define FLASH_ADDR_DEVICE_ID_CANARY (FLASH_SECTOR_DEVICE_ID + 0x0001FF00)
#define FLASH_ADDR_DEVICE_ID        (FLASH_ADDR_DEVICE_ID_CANARY + 4)
#define FLASH_DEVICE_ID_CANARY_VALUE (0xBADACAFE)

#define DEVICE_ID_INVALID (0xFF)

static inline uint8_t get_device_id(void) {
  // device id canary mismatch
  if (*(uint32_t *)FLASH_ADDR_DEVICE_ID_CANARY != FLASH_DEVICE_ID_CANARY_VALUE) {
    Error_Handler();
  }

  uint8_t id = *(uint8_t *)FLASH_ADDR_DEVICE_ID;

  if (id == DEVICE_ID_INVALID) {
    Error_Handler();
  }

  return id;
}

/*******************************************************************************
 * LoRa typedefs and definitions
 ******************************************************************************/
#define LORA_ID_BROADCAST (0)

typedef enum {
  LORA_STATUS_OK = 0,
  LORA_STATUS_ERR_CHECKSUM,
  LORA_STATUS_ERR_NOT_ME,
} lora_status_t;

typedef enum {
  LORA_LSNTP_REQ,     // LSNTP time request from client
  LORA_LSNTP_RES,     // LSNTP time reply from server
  LORA_SENSOR_REPORT, // sensor detection detection
  LORA_ACK,           // ack
} lora_protocol_t;

/*******************************************************************************
 * LoRa packet header
 ******************************************************************************/

typedef struct {
  uint8_t protocol;  // lora mesage type
  uint8_t sender;    // sender device id
  uint8_t receiver;  // receiver device id
  uint8_t sequence;  // sequence number for repeated requests
  uint32_t checksum; // CRC checksum
} lora_header_t;

/*******************************************************************************
 * LoRa utility functions
 ******************************************************************************/

/**
 * @brief calculate and set CRC checksum of the lora packet
 *
 * @param [in] header lora packet header pointer
 * @param [in] packet lora packet pointer
 * @param [in] size   lora packet size
 */
static inline void lora_set_checksum(lora_header_t *header, uint32_t *packet, uint32_t size) {
  header->checksum = 0;
  header->checksum = HAL_CRC_Calculate(&hcrc, packet, size);
}

/**
 * @brief verify CRC checksum and receiver of the lora packet
 *
 * @param[in] id     my device id
 * @param[in] header lora packet header pointer
 * @param[in] packet lora packet pointer
 * @param[in] size   lora packet size
 */
static inline int32_t lora_verify(uint8_t id, lora_header_t *header, uint32_t *packet, uint32_t size) {
  uint16_t checksum = header->checksum;
  header->checksum = 0;

  if (checksum != HAL_CRC_Calculate(&hcrc, packet, size)) {
    return LORA_STATUS_ERR_CHECKSUM;
  }

  if (header->receiver != id) {
    return LORA_STATUS_ERR_NOT_ME;
  }

  return LORA_STATUS_OK;
}

/*******************************************************************************
 * LoRa Simple Network Time Protocol (LSNTP) implementation
 * from RFC 4330 (https://datatracker.ietf.org/doc/html/rfc4330) Page 13
 ******************************************************************************/
#define LSNTP_ITER_COUNT (5)

typedef struct {
  int32_t client_req_tx; // time request sent by client
  int32_t server_req_rx; // time request received by server
  int32_t server_res_tx; // time reply sent by server
  int32_t client_res_rx; // time reply received by client
  lora_header_t header;
} lora_lsntp_t;

static inline int32_t lsntp_calc_offset(lora_lsntp_t *pkt) {
  #ifdef DEBUG
  // round trip time calculation
  int32_t rtt = (pkt->client_res_rx - pkt->client_req_tx) - (pkt->server_res_tx - pkt->server_req_rx);
  printf("RTT: %d\n", rtt);
  #endif /* DEBUG */

  // system clock offset calculation
  int32_t offset = ((pkt->server_req_rx - pkt->client_req_tx) + (pkt->server_res_tx - pkt->client_res_rx)) / 2;

  return offset;
}

/*******************************************************************************
 * LoRa sensor detection notification
 ******************************************************************************/

typedef struct {
  int32_t timestamp;
  lora_header_t header;
} lora_sensor_report_t;

/*******************************************************************************
 * LoRa simple ACK
 ******************************************************************************/
typedef struct {
  lora_header_t header;
} lora_ack_t;

/*******************************************************************************
 * printf
 ******************************************************************************/
int _write(int file, uint8_t *ptr, int len) {
  HAL_UART_Transmit(&huart1, (uint8_t *)ptr, (uint16_t)len, 30);
  return (len);
}

#endif /* COMMON_H */
