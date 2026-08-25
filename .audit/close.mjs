import { browser } from './harness.mjs'

const cdp = await browser()
try {
  await cdp.send('Browser.close')
  console.log('closed')
} catch (error) {
  console.log('close failed:', error.message)
}
cdp.close()
