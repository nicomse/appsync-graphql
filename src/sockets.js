const Utils = require('./utils');
const AWS = require('aws-sdk');
const https = require('https');

const { getUnreadNotifications, pushNotification, getNotification, getNotifications } = require('./notifications');

AWS.NodeHttpClient.sslAgent = new https.Agent({ rejectUnauthorized: false });

const $ddb = Utils.getDynamo();
const $socket = Utils.getSocketApi();

const USERS_TABLE = process.env.USERS_TABLE;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const WHITELIST = process.env.WHITELIST || null;

/**
 * Handles user connection or disconnection from socket
 */
async function $connect(event) {
	if (!!WHITELIST && WHITELIST.split(',').indexOf(event.headers.Origin) === -1) {
		return {
			statusCode: 400,
			body: {
				error: 'Origin domain is not whitelisted'
			}
		};
	}

	// Save socket Id
	await $ddb.put({
		TableName: CONNECTIONS_TABLE,
		Item: {
			connectionId: event.requestContext.connectionId
		}
	}).promise();

	return {
		statusCode: 200
	};
}

async function $disconnect(event) {
	await $ddb.delete({
		TableName: CONNECTIONS_TABLE,
		Key: {
			connectionId: event.requestContext.connectionId
		}
	}).promise();

	return {
		statusCode: 200
	};
}

/**
 * Default socket handler
 */
async function $default(event) {
	const body = JSON.parse(event.body);
	const connectionId = event.requestContext.connectionId;

	// Save which userId belongs to this connectionId
	if (body.action == 'HANDSHAKE') {
		const user = await Utils.getItem(USERS_TABLE, { id: body.userId });

		if (!user) {
			await $socket.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ status: 'ERROR' })
			}).promise();

			return;
		}

		await $ddb.update({
			TableName: CONNECTIONS_TABLE,
			Key: {
				connectionId
			},
			ReturnValues: 'ALL_NEW',
			UpdateExpression: 'set #userId = :userId',
				ExpressionAttributeNames: {
					'#userId': 'userId'
				},
				ExpressionAttributeValues: {
					':userId': body.userId
				}
			}).promise();

		await $socket.postToConnection({
			ConnectionId: connectionId,
			Data: JSON.stringify({ status: 'OK' })
		}).promise();

		// Once we saved the userId
		const notifications = await getNotifications(body.userId);

		await Promise.all(
			notifications.map(notification => {
				return $socket.postToConnection({
					ConnectionId: connectionId,
					Data: JSON.stringify(notification)
				}).promise();
			})
		);

		return {
			statusCode: 200
		};
	}

	await $socket.postToConnection({
		ConnectionId: connectionId,
		Data: JSON.stringify({ echo: body })
	}).promise();

	return {
		statusCode: 200
	};
}

module.exports = { $connect, $disconnect, $default };