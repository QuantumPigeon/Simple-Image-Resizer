'use strict'

const { parse } = require('querystring')

const DEFAULT_EXTENSION = 'webp'
const BAD_JPG_EXTENSION = 'jpg'
const GOOD_JPG_EXTENSION = 'jpeg'
// Preserving aspect ratio, resize the image to be as small as possible while ensuring its dimensions are greater than or equal to both those specified.
const DEFAULT_SCALING = 'outside'

const UriToS3Key = event => {
  console.info("event\n" + event)

  const { request, request: { headers, querystring, uri } } = event.Records[0].cf

  console.info("headers\n" + headers)
  console.info("querystring\n" + querystring)
  console.info("uri\n" + uri)

  const { h: height, w: width, f: format, s: scaling} = parse(querystring)

  if (!width || isNaN(parseInt(width, 10))) return request
  if (!height || isNaN(parseInt(width, 10))) return request

  if (!scaling) {
    throw new Error(`Query Parameter s (scaling type) cannot be empty for resizing operation.`)
  }

  const [,prefix, imageName] = uri.match(/(.*)\/(.*)/)
  console.info("prefix\n" + prefix)
  console.info("imageName\n" + imageName)

  const acceptHeader = Array.isArray(headers.accept)
    ? headers.accept[0].value
    : ''
  const nextExtension = !format ? '' : format

  const dimensions = `${width}x${height}`
  const key = nextExtension == '' ? `${prefix}/${dimensions}/${scaling}/${imageName}` : `${prefix}/${dimensions}/${scaling}/${imageName}.${nextExtension}`

  console.info("key\n" + key)

  request.uri = key
  request.querystring = [
    `width=${width}`,
    `height=${height}`,
    `sourceImage=${uri}`,
    `nextExtension=${nextExtension}`,
    `scaling=${scaling}`,
  ].join('&')

  console.info("request\n" + request)

  return request
}

module.exports = UriToS3Key
