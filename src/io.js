/**
 *
 * wechaty: Wechat for Bot. and for human who talk to bot/robot
 *
 * Class Io
 * http://www.wechaty.io
 *
 * Licenst: ISC
 * https://github.com/zixia/wechaty
 *
 */
const EventEmitter  = require('events')
const WebSocket     = require('ws')
const co            = require('co')

const log           = require('./npmlog-env')
const Contact       = require('./contact')

class Io {

  constructor({
    wechaty = null
    , token = null
    , endpoint = 'wss://api.wechaty.io/v0/websocket'
    , protocol = 'io|0.0.1'
  }) {
    if (!wechaty || !token) {
      throw new Error('Io must has wechaty & token set')
    }
    this.wechaty  = wechaty
    this.token    = token
    this.endpoint = endpoint
    this.protocol = protocol
    log.verbose('Io', 'instantiated with endpoint[%s], token[%s], protocol[%s]', endpoint, token, protocol)
  }

  toString() { return 'Class Io(' + this.token + ')'}

  connected() { return this.ws && this.ws.readyState === WebSocket.OPEN }

  init() {
    log.verbose('Io', 'init()')

    return co.call(this, function* () {
      yield this.initEventHook()
      yield this.initWebSocket()

      return this
    }).catch(e => {
      log.warn('Io', 'init() exception: %s', e.message)
      throw e
    })
  }

  initWebSocket() {
    log.verbose('Io', 'initWebSocket()')
    // const auth = 'Basic ' + new Buffer(this.token + ':X').toString('base64')
    const auth = 'Token ' + this.token
    const headers = { 'Authorization': auth }

    const ws = this.ws = new WebSocket(this.endpoint, this.protocol, { headers })

    ws.on('open', function open() {
      if (this.protocol !== ws.protocol) {
        log.error('Io', 'initWebSocket() require protocol[%s] failed', this.protocol)
        // XXX deal with error?
      }
      log.verbose('Io', 'initWebSocket() connected with protocol [%s]', ws.protocol)

      ws._socket.setKeepAlive(true, 30000)

      this.reconnectTimeout = null
      ws.send('Wechaty version ' + this.wechaty.version())
    }.bind(this))

    ws.on('message', (data, flags) => {
      log.silly('Io', 'initWebSocket() ws.on(message): %s', data)
      // flags.binary will be set if a binary data is received.
      // flags.masked will be set if the data was masked.
      
      const ioEvent = {
        name: 'raw'
        , payload: data
      }
      
      try {
        const obj = JSON.parse(data)
        ioEvent.name    = obj.name
        ioEvent.payload = obj.payload
      } catch (e) {
        log.verbose('Io', 'on(message) recv a non IoEvent data[%s]', data)
      }

      switch (ioEvent.name) {
        case 'botie':
          const payload = ioEvent.payload
          if (payload.onMessage) {
            const script = payload.script
            const fn = eval(script)
            if (typeof fn === 'function') {
              this.onMessage = fn
            } else {
              log.warn('Io', 'server pushed function is invalid')
            }
          }
          break
        
        case 'reset':
          log.verbose('Io', 'on(reset): %s', ioEvent.payload)
          this.wechaty.reset()
          break
          
        case 'update':
          log.verbose('Io', 'on(report): %s', ioEvent.payload)
          const user = this.wechaty.user()
          if (user) {
            const loginEvent = {
              name:       'login'
              , payload:  user.obj
            }
            this.send(loginEvent)
          } 
          break
          
        case 'sys':
          // do nothing
          break
          
        default:
          log.warn('Io', 'UNKNOWN on(%s): %s', ioEvent.name, ioEvent.payload)
          break
      }
    })

    ws
    .on('close', e => {
      log.verbose('Io', 'initWebSocket() close event[%s]', e)
      ws.close()
      this.reconnect()
    })
    .on('error', e => {
      log.verbose('Io', 'initWebSocket() error event[%s]', e.message)
      this.wechaty.emit('error', e)

      this.close()
      this.reconnect()
    })

    return Promise.resolve()
  }

  reconnect() {
    if (this.connected()) {
      log.warn('Io', 'reconnect() on a already connected io')
    } else if (this.reconnectTimer) {
      log.warn('Io', 'reconnect() on a already re-connecting io')
    } else {
      if (!this.reconnectTimeout) {
        this.reconnectTimeout = 100
      } else if (this.reconnectTimeout < 10000) {
        this.reconnectTimeout *= 2
      }
      log.warn('Io', 'reconnect() will reconnect after %d s', Math.floor(this.reconnectTimeout/1000))
      this.reconnectTimer = setTimeout(_ => {
        this.reconnectTimer = null
        this.initWebSocket()
      }, this.reconnectTimeout)
    }
  }

  initEventHook() {
    const wechaty = this.wechaty

    wechaty.on('message', this.ioMessage)

    const hookEvents = [
      'scan'
      , 'login'
      , 'logout'
      , 'error'
      , 'heartbeat'
    ]
    hookEvents.map(event => {
      wechaty.on(event, data => {
        if (!this.connected()) {
          log.verbose('Io', 'initEventHook() on event[%s] without a connected websocket', event)
          return
        }
        const ioEvent = {
          name:       event
          , payload:  data
        }
        
        switch (event) {
          case 'login':
          case 'logout':
            if (data instanceof Contact) {
              ioEvent.payload = data.obj
            }
            break
          
          default:
            break
        }
      
        this.send(ioEvent)
      })
    })

    return Promise.resolve()
  }

  send(ioEvent) {
    log.silly('Io', 'send(%s: %s)', ioEvent.name, ioEvent.payload)
    this.ws.send(
      JSON.stringify(
        ioEvent
      )
    )
  }
  
  close() {
    this.ws.close()
    // TODO: remove listener for this.wechaty.on(message )
  }

  /**
   *
   * Prepare to be overwriten by server setting
   *
   */
  ioMessage(m) {
    log.verbose('Io', 'ioMessage() is a nop function before be overwriten from cloud')
  }
}

/**
 * Expose `Wechaty`.
 */
module.exports = Io.default = Io.Io = Io
