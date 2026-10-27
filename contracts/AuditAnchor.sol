// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AuditAnchor
/// @notice Commits the head hash of AgentShield's receipt chain. Once a head is anchored, any
///         later edit to an earlier receipt changes the recomputed chain and no longer matches.
contract AuditAnchor {
    address public immutable owner;
    bytes32 public head;
    uint256 public seq;

    event Anchored(bytes32 indexed head, uint256 seq, uint256 timestamp);

    error NotOwner();
    error SeqMustIncrease();

    constructor() {
        owner = msg.sender;
    }

    function anchor(bytes32 newHead, uint256 newSeq) external {
        if (msg.sender != owner) revert NotOwner();
        if (newSeq <= seq && seq != 0) revert SeqMustIncrease();
        head = newHead;
        seq = newSeq;
        emit Anchored(newHead, newSeq, block.timestamp);
    }
}
