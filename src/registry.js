// Every tool the panel offers, in the order the home screen lists them within each group.
// To add a tool: write src/views/<id>.js exporting { id, title, group, icon, color, description,
// keywords, create() } (see views/jwt.js), import it here, and, if pasted values can be recognised, teach
// detect.js its shape.
import base64 from './views/base64.js'
import bcrypt from './views/bcrypt.js'
import changeCase from './views/case.js'
import cert from './views/cert.js'
import chars from './views/chars.js'
import chmod from './views/chmod.js'
import color from './views/color.js'
import cidr from './views/cidr.js'
import cron from './views/cron.js'
import cssunits from './views/cssunits.js'
import csv from './views/csv.js'
import curl from './views/curl.js'
import diff from './views/diff.js'
import escape from './views/escape.js'
import hash from './views/hash.js'
import http from './views/http.js'
import image from './views/image.js'
import ids from './views/ids.js'
import json from './views/json.js'
import jsx from './views/jsx.js'
import jwt from './views/jwt.js'
import lines from './views/lines.js'
import number from './views/number.js'
import objectid from './views/objectid.js'
import password from './views/password.js'
import qr from './views/qr.js'
import regex from './views/regex.js'
import sql from './views/sql.js'
import stats from './views/stats.js'
import time from './views/time.js'
import transform from './views/transform.js'
import types from './views/types.js'
import units from './views/units.js'
import url from './views/url.js'
import xml from './views/xml.js'
import yaml from './views/yaml.js'

export const GROUPS = ['Inspect', 'Encode', 'Convert', 'Format', 'Generate', 'Text']

export const TOOLS = [
  jwt, cert, time, objectid, cron, http, cidr, chars,
  base64, image, url, escape,
  yaml, csv, types, curl, jsx, cssunits, units, color, number, chmod,
  json, sql, xml,
  password, ids, hash, bcrypt, qr,
  transform, changeCase, regex, diff, lines, stats
]

/** Tools whose title, description or keywords contain every word of the query. */
export function searchTools(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return TOOLS
  return TOOLS.filter((tool) => {
    const haystack = [tool.title, tool.description, tool.id, ...tool.keywords].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
