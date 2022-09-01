'use strict'

const AWS = require('aws-xray-sdk').captureAWS(require('aws-sdk'))
const Sharp = require('sharp')
const { parse } = require('querystring')

const S3 = new AWS.S3()

const GetOrCreateImage = async event => {
  console.info("GetOrCreateImage handler")

  const {
    cf: {
      request: {
        origin: {
          s3: {
            domainName
          }
        },
        querystring,
        uri
      },
      response,
      response: {
        status
      }
    }
  } = event.Records[0]

  console.info(JSON.stringify(response, null, 4))

  if (!['403', '404'].includes(status)) return response

  console.info("domainName\n" + domainName)
  console.info("uri\n" + uri)

  let { width, height, sourceImage, nextExtension, scaling, cloudFrontUrl } = parse(querystring)
  const [bucket] = domainName.match(/.+(?=\.s3\..*\.amazonaws\.com)/i)

  if (sourceImage == null) {
    console.error('sourceImage is null or undefined') 
    return {
      ...response,
      status: 404,
      statusDescription: 'Not Found',
      body: 'sourceImage is null or undefined',
      bodyEncoding: 'text',
      headers: {
        ...response.headers,
        'content-type': [{ key: 'Content-Type', value: 'text/plain' }]
      }
    }
  }

  width = parseInt(width, 10)
  if (isNaN(width)) width = null;

  height = parseInt(height, 10)
  if (isNaN(height)) height = null;

  console.info("bucket\n" + bucket)

  console.info("sourceImage\n" + sourceImage)

  let contentType = 'image/' + nextExtension

  console.info("contentType\n" + contentType)

  let key = uri.replace(/^\//, '')
  console.info("key\n" + key)
  const sourceKey = sourceImage.replace(/^\//, '')
  console.info("sourceKey\n" + sourceKey)

  return S3.getObject({ Bucket: bucket, Key: sourceKey })
    .promise()
    .then(imageObj => {
      let resizedImage
      const errorMessage = `Error while resizing "${sourceKey}" to "${key}":`

      console.info("imageObj.ContentType\n" + JSON.stringify(imageObj.ContentType, null, 4))

      let originalFormat = imageObj.ContentType.replace(/^(image\/)/,'');
      if (nextExtension == '') {
        nextExtension = originalFormat;
        console.info("nextExtension\n" + nextExtension)
        contentType = 'image/' + nextExtension
        console.info("New contentType\n" + contentType)
        key = key + "." + nextExtension
        console.info("key\n" + key)
      }

      let isAnimated = (originalFormat == "gif") ? true : false;
      console.info("isAnimated \n" + isAnimated)

      // Required try/catch because Sharp.catch() doesn't seem to actually catch anything. 
      try {
        resizedImage = Sharp(imageObj.Body, { animated: isAnimated })
          .rotate()
          .resize(width, height, {
            withoutEnlargement: true,
            fit: scaling,
          })
          .toFormat(nextExtension, {
            /**
             * @see https://sharp.pixelplumbing.com/api-output#webp for a list of options.
             */
            quality: 95
          })
          .toBuffer()
          .catch(error => {
            console.error(`${errorMessage} ${error}`)
            throw new Error(`${errorMessage} ${error}`)
          })
      } catch(error) {
        console.error(`${errorMessage} ${error}`)
        console.error('Image resizing failed, returning original')
        return imageObj.Body
      }
      return resizedImage
    })
    .then(async imageBuffer => {
      let s3_response = await S3.putObject({
        Body: imageBuffer,
        Bucket: bucket,
        ContentType: contentType,
        Key: key,
        StorageClass: 'STANDARD'
      }).promise()
        .catch(error => {
          console.error(`Error while putting resized image '${uri}' into bucket:${error}`)
          throw new Error(`Error while putting resized image '${uri}' into bucket: ${error}`)
        })

      console.info("s3_response \n" + s3_response)
      const redirectUrl = 'https://' + cloudFrontUrl + '/' + key + '?t=' + Date.now()  
      console.info("redirectUrl \n" + redirectUrl)

      return {
        ...response,
        status: 302,
        statusDescription: 'Moved',
        // body: imageBuffer.toString('base64'),
        bodyEncoding: 'base64',
        headers: {
          ...response.headers,
          'location': [{ key: 'Location', value: redirectUrl }],
          'x-reason': [{ key: 'X-Reason', value: 'Generated.' }],
        }
      }
    })
    .catch(error => {
      const errorMessage = `Error while getting source image object "${sourceKey}": ${error}`
      console.error(errorMessage)

      return {
        ...response,
        status: 404,
        statusDescription: 'Not Found',
        body: errorMessage,
        bodyEncoding: 'text',
        headers: {
          ...response.headers,
          'content-type': [{ key: 'Content-Type', value: 'text/plain' }]
        }
      }
    })
}

module.exports = GetOrCreateImage
