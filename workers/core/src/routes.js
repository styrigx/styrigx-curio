/**
 * @fileoverview 接口路由表：/api/<路径> → src/api/<路径>.js。
 * src/api/ 新增或删除接口文件时这里要同步，tests/workers/core.test.mjs 会检查两边一致。
 * 下划线开头的文件不是接口（_auth、_lib、_write、_store、_netscape、_preview、_items）。
 */
import * as exportApi from './api/export.js';
import * as icon from './api/icon.js';
import * as importApi from './api/import.js';
import * as items from './api/items.js';
import * as links from './api/links.js';
import * as photo from './api/photo.js';
import * as preview from './api/preview.js';

/** @type {Map<string, Record<string, Function>>} */
export const API_ROUTES = new Map([
  ['/api/export', exportApi],
  ['/api/icon', icon],
  ['/api/import', importApi],
  ['/api/items', items],
  ['/api/links', links],
  ['/api/photo', photo],
  ['/api/preview', preview],
]);
