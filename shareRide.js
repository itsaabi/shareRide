import { createLibp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { multiaddr } from "@multiformats/multiaddr";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { ping } from "@libp2p/ping";
import { webRTC } from "@libp2p/webrtc";

const rideShareTopic = "ride-share-requests-v2";
const shareRideTopic = "share-ride-posts-v2";
const relayId = "12D3KooWSyy6Pxb7kG9FZLFBHAAvR7ADjqQ4pcZZDug4yCxx1vL2";
const relayAddr = `/ip4/127.0.0.1/tcp/15001/ws/p2p/${relayId}`;

class ShareRideNode {
  constructor() {
    this.node = null;
    this.rideShareProtocol = "/ride-share/1.0.0";
    this.pendingRequests = {};
    this.activeOffers = {};
    this.riderProfile = this.getRiderProfileFromLocalStorage();
    this.sharedRides = [];
    this.messageHandler = null;
  }

  getRiderProfileFromLocalStorage() {
    try {
      const profileData = JSON.parse(localStorage.getItem("riderProfileData")) || {};
      return {
        name: profileData.name || "Rider",
        phone: profileData.phone || "N/A",
        profileImage: profileData.profileImage || "https://via.placeholder.com/150?text=Rider",
      };
    } catch (error) {
      console.error("Error loading rider profile:", error);
      return {
        name: "Rider",
        phone: "N/A",
        profileImage: "https://via.placeholder.com/150?text=Rider",
      };
    }
  }

  async initialize() {
    try {
      this.node = await createLibp2p({
        listen: ["/webrtc", "/p2p-circuit"],
        transports: [webRTC(), webSockets(), circuitRelayTransport()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          ping: ping(),
          identify: identify(),
          pubsub: gossipsub({
            allowPublishToZeroTopicPeers: true,
            fallbackToFloodsub: true,
            floodPublish: true,
            globalSignaturePolicy: "StrictNoSign",
            doPX: false,
            msgIdFn: (msg) => msg.data,
            seenTTL: 300000,
          }),
        },
      });

      await this.connectToRelay();
      
      // Subscribe to topics
      this.node.services.pubsub.subscribe(rideShareTopic);
      this.node.services.pubsub.subscribe(shareRideTopic);
      console.log("Subscribed to topics:", rideShareTopic, shareRideTopic);

      // Set up message handler
      this.node.services.pubsub.addEventListener("message", (evt) => {
        if (this.messageHandler) {
          this.messageHandler(evt);
        }
      });

      // Set up protocol handler
      this.node.handle(this.rideShareProtocol, async ({ stream }) => {
        const decoder = new TextDecoder();
        let data = '';
        for await (const chunk of stream.source) {
          data += decoder.decode(chunk, { stream: true });
        }
        const message = JSON.parse(data);
        this.handleRideShareMessage(message);
      });

      await this.discoverPeers();
      
      console.log("ShareRideNode initialized successfully");
      return true;
    } catch (err) {
      console.error("Failed to initialize node:", err);
      throw err;
    }
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  async connectToRelay() {
    let attempts = 0;
    while (attempts < 3) {
      try {
        await this.node.dial(multiaddr(relayAddr));
        console.log("Connected to relay node");
        return true;
      } catch (err) {
        attempts++;
        console.log("Attempt", attempts, "to connect to relay failed");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw new Error("Failed to connect to relay");
  }

  async discoverPeers() {
    const peers = await this.node.peerStore.all();
    for (const peer of peers) {
      if (peer.id.toString() !== this.node.peerId.toString()) {
        try {
          await this.node.dial(peer.id);
          console.log("Dialed peer:", peer.id.toString());
        } catch (err) {
          console.log("Failed to dial peer:", peer.id.toString());
        }
      }
    }
  }

  handleIncomingMessage(evt) {
    try {
      if (evt.detail.topic === shareRideTopic) {
        const message = JSON.parse(new TextDecoder().decode(evt.detail.data));
        
        if (message.type === 'ride-share-post') {
          console.log('Received shared ride:', message);
          this.handleSharedRidePost(message);
        }
      } else if (evt.detail.topic === rideShareTopic) {
        const message = JSON.parse(new TextDecoder().decode(evt.detail.data));
        
        if (message.type === 'ride-share-response') {
          this.handleRideShareResponse(message);
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  }

  handleSharedRidePost(post) {
    console.log('Processing shared ride post:', post);
    this.sharedRides.push(post);
    this.displaySharedRide(post);
  }

  displaySharedRide(post) {
    const rideElement = document.createElement('div');
    rideElement.className = 'shared-ride';
    rideElement.innerHTML = `
      <div class="shared-ride-header">
        <h4>Shared Ride Available</h4>
        <small>${new Date(post.timestamp).toLocaleTimeString()}</small>
      </div>
      <div class="shared-ride-details">
        <div class="driver-info">
          <img src="${post.driver.profileImage}" alt="Driver" 
               onerror="this.src='https://via.placeholder.com/50?text=Driver'">
          <div>
            <p><strong>Driver:</strong> ${post.driver.name}</p>
            <p><i class="fas fa-phone"></i> ${post.driver.phone}</p>
          </div>
        </div>
        <div class="route-info">
          <p><i class="fas fa-map-marker-alt"></i> ${post.rider.origin}</p>
          <p><i class="fas fa-flag"></i> ${post.rider.destination}</p>
          <p><i class="fas fa-chair"></i> ${post.rider.seatsAvailable} seat${post.rider.seatsAvailable !== 1 ? 's' : ''} available</p>
        </div>
      </div>
      <div class="shared-ride-actions">
        <button class="join-ride" data-ride-id="${post.rideId}">Join Ride</button>
      </div>
    `;

    const container = document.getElementById('shared-rides-container') || 
                      document.querySelector('.shared-rides');
    if (container) {
      container.prepend(rideElement);
    }

    rideElement.querySelector('.join-ride').addEventListener('click', () => {
      this.requestToJoinRide(post);
    });
  }

  requestToJoinRide(post) {
    const pickup = prompt('Enter your pickup location:');
    if (!pickup) return;

    const seats = prompt(`How many seats do you need? (Available: ${post.rider.seatsAvailable})`, "1");
    if (!seats) return;

    this.sendRideJoinRequest(post, pickup, parseInt(seats));
  }

  async sendRideJoinRequest(post, pickup, seats) {
    try {
      const request = {
        type: "ride-share-request",
        requestId: `join-${Date.now()}`,
        riderInfo: this.riderProfile,
        pickup: pickup,
        destination: post.rider.destination,
        seatsRequired: seats,
        timestamp: Date.now(),
        requesterPeerId: this.node.peerId.toString(),
        rideId: post.rideId,
        driverPeerId: post.driver.peerId
      };

      this.pendingRequests[request.requestId] = request;

      await this.node.services.pubsub.publish(
        rideShareTopic,
        new TextEncoder().encode(JSON.stringify(request))
      );

      if (post.driver.peerId) {
        try {
          const conn = await this.node.dial(post.driver.peerId);
          const stream = await conn.newStream(this.rideShareProtocol);
          const encoder = new TextEncoder();
          const writer = stream.sink.getWriter();
          await writer.write(encoder.encode(JSON.stringify(request)));
          await writer.close();
        } catch (err) {
          console.error('Failed to send direct join request:', err);
        }
      }

      console.log('Sent ride join request:', request);
      this.showRequestSentUI(request.requestId);
    } catch (err) {
      console.error('Error sending ride join request:', err);
    }
  }

  showRequestSentUI(requestId) {
    const request = this.pendingRequests[requestId];
    if (!request) return;

    const element = document.querySelector(`[data-ride-id="${request.rideId}"]`)?.closest('.shared-ride');
    if (element) {
      element.querySelector('.shared-ride-actions').innerHTML = `
        <div class="request-pending">
          <i class="fas fa-spinner fa-spin"></i>
          <span>Request sent</span>
        </div>
      `;
    }
  }

  handleRideShareMessage(message) {
    if (message.type === "ride-share-response") {
      this.handleRideShareResponse(message);
    }
  }

  handleRideShareResponse(response) {
    const request = this.pendingRequests[response.requestId];
    if (!request) return;

    if (response.accepted) {
      console.log("Ride-share request accepted:", response);
      this.showRideShareAccepted(response, request);
    } else {
      console.log("Ride-share request declined");
      this.showRideShareDeclined(request);
    }

    delete this.pendingRequests[response.requestId];
  }

  showRideShareAccepted(response, request) {
    const element = document.querySelector(`[data-ride-id="${request.rideId}"]`)?.closest('.shared-ride');
    if (element) {
      element.querySelector('.shared-ride-actions').innerHTML = `
        <div class="request-accepted">
          <i class="fas fa-check-circle"></i>
          <span>Accepted! Driver: ${response.driverInfo.name}</span>
        </div>
      `;
    }

    if (window.showDriverContactInfo) {
      window.showDriverContactInfo(response.driverInfo);
    }
  }

  showRideShareDeclined(request) {
    const element = document.querySelector(`[data-ride-id="${request.rideId}"]`)?.closest('.shared-ride');
    if (element) {
      element.querySelector('.shared-ride-actions').innerHTML = `
        <div class="request-declined">
          <i class="fas fa-times-circle"></i>
          <span>Declined</span>
          <button class="try-other-ride">Find Another Ride</button>
        </div>
      `;

      element.querySelector('.try-other-ride').addEventListener('click', () => {
        // Implement logic to find other rides
      });
    }
  }

  async publishRideRequest(requestDetails) {
    try {
      const message = {
        type: "ride-share-request",
        requestId: `req-${Date.now()}`,
        riderInfo: this.riderProfile,
        pickup: requestDetails.pickup,
        destination: requestDetails.destination,
        seatsRequired: requestDetails.seatsRequired || 1,
        timestamp: Date.now(),
        requesterPeerId: this.node.peerId.toString()
      };

      await this.node.services.pubsub.publish(
        rideShareTopic,
        new TextEncoder().encode(JSON.stringify(message))
      );

      console.log("Published ride-share request:", message);
      return message.requestId;
    } catch (err) {
      console.error("Failed to publish ride-share request:", err);
      return null;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.shareRideNode = new ShareRideNode();
  window.shareRideNode.initialize();
});