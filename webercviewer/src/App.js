import React, { Component } from 'react';
import {
  Card,
  CardTitle,
  CardText,
  Button,
  Label,
  Input,
  ListGroup,
  ListGroupItem,
  Modal, ModalHeader, ModalBody, ModalFooter
} from 'reactstrap'

import logo from './logo.svg';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props)

    this.state = {
      connectedUsers: [],
      connected: false,
      username: null,

      incomingCaller: null,
      pendingRemoteSDP: null,
      peerConnectionConfig: {}
    }

    this.socket = null

    this.peerConnection = null

    this.mediaConstraints = {
      video: true,
      audio: true
    }

  }

  onSocketMessage(msg) {
    let payload
    try {
      payload = JSON.parse(msg.data)
    } catch(e) {
      console.log(e)
      return
    }
    console.log('payload',payload)
    switch(payload.type) {
      case "login":
        if(payload.name) {
          this.setState({
            connectedUsers: this.state.connectedUsers.concat(payload.name)
          })
        }
        else if(payload.success) {
          this.setState({
            connected: true
          })
          // get the overview once logged in
          this.sendJson({
            type: "overview",
            name: this.state.username
          })
        }
        break
      case "overview":
        if(payload.users) {
          this.setState({
            connectedUsers:
            this.state.connectedUsers.concat(payload.users)
          })
        }
        break
      case "candidate":
        if(this.peerConnection && payload.candidate) {
          console.log('add candidate')
          this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
        }
        break

      case "offer":
        try {
          let {name,offer} = payload
          this.setState({
            incomingCaller: name,
            pendingRemoteSDP: offer
          })

        } catch(e) {
          console.log('malformed offer:',e)
        }
        break
      case "answer":
        console.log(payload)
        try {
          this.peerConnection.setRemoteDescription(
            payload.payload
          )
        } catch(e) {
          console.log("failed to answer",e)
        }
    }
  }

  sendJson(data) {
    this.socket.send(JSON.stringify(data))
  }
  login(username) {
    // first set the username in state, then try to login
    this.setState({
      username
    }, () => {
      this.sendJson({
        type: "login",
        name: username
      })
    })
  }

  getOverview() {
    this.socket && this.sendJson({
      type: 'overview'
    })
  }
  connect() {
    const address = document.getElementById("serverAddress").value
    const username = document.getElementById("username").value
    this.socket = new WebSocket(`ws://${address}:9090`)
    this.socket.onopen = () => {
      this.login(username)
    }
    this.socket.onmessage = this.onSocketMessage.bind(this)
    this.setState({
      peerConnectionConfig: {
        'iceServers': [{url: `stun:${address}`}],
          'offerToReceiveAudio':true,
          'offerToReceiveVideo':true
      }
    })
  }

  setStreamToVideoElement(eleId, stream) {
    console.log(stream)
    const e = document.getElementById(eleId)
    e.srcObject = stream
  }

  setupPeerConnection(user) {
    console.log('rtc config:',this.state.peerConnectionConfig)
    this.peerConnection = new RTCPeerConnection(this.state.peerConnectionConfig)
    this.peerConnection.onicecandidate = e => {
      console.log('on ice candidate')
      this.sendCandidate(e.candidate,user)
    }
    this.peerConnection.oniceconnectionstatechange = _ => {
      console.log('ice connection state changed to',
        this.peerConnection.iceConnectionState)
    }
    this.peerConnection.onaddstream = event => {
      console.log('on add stream')
      const stream = event.stream
      document.getElementById('video-stream-renderer').srcObject = stream
    }
  }
  call(user) {
    this.setupPeerConnection(user)
    console.log('calling user')
    this.peerConnection.createOffer(
      {
        'offerToReceiveAudio':true,
        'offerToReceiveVideo':true
      })
      .then(offer => {
        console.log('setting local description')
        this.peerConnection.setLocalDescription(offer)
        return offer
      })
      .then(offer => {
        console.log("notifying another side for offer")
        this.sendJson({
          type: 'offer',
          name: user,
          payload: offer.toJSON()
        })
      })
      .then(() => {this.createMediaStream()})

  }

  createMediaStream() {
    return navigator.mediaDevices
      .getUserMedia(this.mediaConstraints)
      .then(stream => {
        this.setStreamToVideoElement('video-local-stream-renderer',stream)
        this.peerConnection.addStream(stream)
      })
  }
  answer() {
    this.setupPeerConnection(this.state.incomingCaller)
    this.peerConnection.setRemoteDescription(this.state.pendingRemoteSDP)
      .then(() => this.peerConnection.createAnswer())
      .then(answer => {
        this.sendJson({
          type: 'answer',
          name: this.state.incomingCaller,
          payload: answer.toJSON()
        })


        console.log("call answered!")
        console.log(this.peerConnection)
        this.setState({
          pendingRemoteSDP: null,
          incomingCaller: null
        })
      })
      .then(() => {this.createMediaStream()})
  }

  rejectCall() {

  }
  sendCandidate(c,user) {
    this.sendJson({
      type: 'candidate',
      name: user,
      candidate: c
    })
  }

  getConnectionConfigCard() {
    return (
      <Card body>
        <CardTitle>
          Connection Settings
        </CardTitle>
        <CardText>
          <Label> Server Adress </Label>
          <Input id="serverAddress" type="text" />
          <Label> Username </Label>
          <Input id="username" type="text" />
        </CardText>
        <Button
          disabled={this.state.connected}
          onClick={this.connect.bind(this)}>
          {this.state.connected?"Connected":"Connect"}
        </Button>
        <div className="userList">
            <CardTitle> Connected users </CardTitle>
            <ListGroup>
              {
                this.state.connectedUsers.map(user => (
                  <ListGroupItem
                    key={user}
                    onClick={this.call.bind(this,user)}
                  >
                  {user}
                  </ListGroupItem>
                ))
              }
            </ListGroup>

        </div>
      </Card>
    )
  }
  render() {
    return (
      <div className="App">
        <Modal
          isOpen={!!this.state.incomingCaller}
        >
          <ModalHeader> Incoming Call </ModalHeader>
          <ModalBody>
            {this.state.incomingCaller} is calling you!
          </ModalBody>
          <ModalFooter>
            <Button color="primary" onClick={this.answer.bind(this)}>
              Accept
            </Button>
            <Button>
              Reject
            </Button>
          </ModalFooter>
        </Modal>
        <div className="optionRow">
          {this.getConnectionConfigCard()}
        </div>
        <div xs="8" className="renderView">
          <video autoPlay id="video-local-stream-renderer"></video>
          <video autoPlay id="video-stream-renderer"></video>
        </div>
      </div>
    );
  }
}

export default App;
